**Status:** on hold, in draft. Do not merge the head `9006a439fb2`. The fix needs a decision on the layer first. This replaces my note of 11-11.

**The decision**

Three routes fix a throw from a `'data'` listener of `child.stdout` and `child.stderr`. I built or measured each one against the same tests: `test/js/node/child_process/child_process.test.ts` of the branch [`robobun/f00c9907/arm-wip`](https://github.com/oven-sh/bun/tree/robobun/f00c9907/arm-wip) (`45f1711f455`), release builds, Linux x64. On main 14 of those tests fail.

| Route | Tests that fail |
|---|---|
| 1. Pass the fds of stdout and stderr to `net.Socket`, as asked for in #36316. `stdio[3]` and above use this route today. | 7 |
| 2. A read callback in `FileReader`, built on the branch above. | 1 |
| 3. One `catch` where `'data'` is dispatched, JS only, with the native change of #44849. | not run on these tests |

One failure in each column is a test that needs more than 10240 open fds, which this machine cannot give.

Route 1. I measured it on main's binary by sending stdout and stderr through two extra `"pipe"` slots.
- All 13 tests that fail on main pass. `net.ts` already reports a listener throw as `uncaughtException`, and the stream reads on.
- 2 failures are tests I wrote that expect an unref'd child with unread pipes not to hold the parent. The expectation is wrong: Node v26.3.0 and Bun 1.3.14 hold the parent for the life of the pipes, and Bun 1.4.0 and later do not (#41632).
- 3 failures: `destroy()` inside `'data'` is followed by `'end'`.
- 1 failure: after a fatal throw the stream still reaches `'close'`, so a program that exits with the child's code exits 0. #34661 is about this.
- Also open: the child's `'exit'` can come before the data of its pipe (#33614), about 18 more syscalls per spawn, one load of `node:net`, and Windows (#47776).

Route 2. It fixes the throw, gives Node's order of `'data'`, ticks and promise jobs, and removes the pull promise per chunk. It adds about 600 native lines and new primitives in `FileReader` and the event loop. A review of the build found defects, and I confirmed these:
- stdout reaches `'end'` and `'close'` before the first `'data'` of stderr (script A). Node and main deliver both `'data'` events first.
- In one sequence the listener runs four more times after a fatal throw, `'end'` fires, and a program that exits with the child's code exits 0 (script B). Node and main stop at the throw and exit 1.
- The Windows code compiled but never ran.

Route 3 fixes the throw for these two streams and nothing else in the table. It is the smallest change and it is ready as a stopgap.

I do not push route 2 over this PR. Which route should this be?

**Found on the way**
- Since 1.4.0 a loop of `await once(child.stdout, "data")` loses bytes: 1.2 to 2.6 MB of 3 MB on main and on 1.4.4, none on 1.3.14 and on Node (script C). Routes 1 and 2 remove the loss. Route 3 does not. This is a separate bug in the shared `read()` of `native-readable.ts`.
- #48553 (a chunk that a later read writes over) is independent and stays as it is.

<details><summary>Scripts</summary>

A. Order across the two pipes. Node and main: `out:data err:data out:end err:end ...`. Route 2: `out:data out:end out:close err:data err:end err:close`, with 0 bytes of stderr at the `'close'` of stdout.

```js
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "echo hi; echo err >&2"]);
const ev = [];
let errAtOutClose = null, err = "";
c.stdout.on("data", d => ev.push("out:data"));
c.stderr.on("data", d => { err += d; ev.push("err:data"); });
c.stdout.on("end", () => ev.push("out:end"));
c.stderr.on("end", () => ev.push("err:end"));
c.stdout.on("close", () => { errAtOutClose = err.length; ev.push("out:close"); });
c.stderr.on("close", () => ev.push("err:close"));
c.on("close", () => console.log(ev.join(" "), "| stderr bytes at stdout close:", errAtOutClose));
```

B. A fatal throw after the stream was read with `read()`. Node and main: `head`, `data 1`, `data 2`, exit code 1. Route 2: `data 3` to `data 6`, `end`, `child exit 0`, `child close 0`, exit code 0 (3 of 3 runs).

```js
const { spawn } = require("node:child_process");
const writer = `const b = Buffer.alloc(65536, 120); let i = 0;
  (function w() { while (i < 24) { i++; if (!process.stdout.write(b)) return process.stdout.once('drain', w); } })();`;
const child = spawn(process.execPath, ["-e", writer], { stdio: ["ignore", "pipe", "inherit"] });
const out = child.stdout;
let n = 0;
const busy = ms => { const until = Date.now() + ms; while (Date.now() < until); };
child.on("exit", code => console.log("child exit", code));
child.on("close", code => { console.log("child close", code); process.exit(code); });
out.on("end", () => console.log("end"));
setTimeout(() => {
  const head = out.read();
  console.log("head", head && head.length);
  out.read();
  out.once("readable", () => {
    out.on("data", chunk => {
      console.log("data", ++n, chunk.length);
      busy(50);
      if (n === 2) throw new Error("boom");
    });
  });
}, 300);
```

C. Byte loss since 1.4.0. Node and Bun 1.3.14: `got 3000000 lost 0`. Main: for example `got 360448 lost 2639552`.

```js
import { spawn } from "node:child_process";
import { once } from "node:events";
const N = 3000000;
const child = spawn("sh", ["-c", `head -c ${N} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] });
const s = child.stdout;
let got = 0, ended = false;
s.on("end", () => { ended = true; });
const t = setTimeout(() => { console.log(`TIMEOUT got ${got} lost ${N - got}`); process.exit(2); }, 4000);
while (!ended) {
  const r = await Promise.race([once(s, "data"), once(s, "end").then(() => null)]);
  if (!r) break;
  got += r[0].length;
}
clearTimeout(t);
console.log(`got ${got} lost ${N - got}`);
process.exit(0);
```

The original problem (unchanged): `bun x.mjs` hangs on main with `STILL ALIVE at 4 s | read 131072 of 655360 | unhandledRejection`. Node prints `EXIT 0 | read 655360 of 655360 | uncaughtException | child exit 0`.

```js
import cp from "node:child_process";
const ev = [];
process.on("uncaughtException", () => ev.push("uncaughtException"));
process.on("unhandledRejection", () => ev.push("unhandledRejection"));
let got = 0, n = 0;
const ch = cp.spawn("sh", ["-c", "for i in 1 2 3 4 5 6 7 8 9 10; do head -c 65536 /dev/zero; sleep 0.02; done"]);
ch.stdout.on("data", d => { got += d.length; if (++n === 2) throw new Error("boom"); });
ch.on("exit", c => ev.push("child exit " + c));
process.on("exit", c => console.log("EXIT", c, "| read", got, "of 655360 |", ev.join(" | ")));
setTimeout(() => console.log("STILL ALIVE at 4 s | read", got, "of 655360 |", ev.join(" | ")), 4000).unref();
```

</details>
