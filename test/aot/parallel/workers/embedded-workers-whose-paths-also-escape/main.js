// Seven files that are embedded with the file loader start Workers, and what holds their paths is also stored where the compiler cannot follow it.
import * as a from "./a.js" with { type: "file" };
import * as b from "./b.js" with { type: "file" };
import * as c from "./c.js" with { type: "file" };
import * as d from "./d.js" with { type: "file" };
import * as e from "./e.js" with { type: "file" };
import * as f from "./f.js" with { type: "file" };
import * as g from "./g.js" with { type: "file" };
const hidden = text => JSON.parse(JSON.stringify(text));
globalThis[hidden("kept")] = [a, b, c, d, e, f, g];
const workers = [
  new Worker(a.default),
  new Worker(b.default),
  new Worker(c.default),
  new Worker(d.default),
  new Worker(e.default),
  new Worker(f.default),
  new Worker(g.default),
];
const answers = workers.map(
  worker =>
    new Promise(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => resolve("error: " + event.message.split("\n")[0].slice(0, 12));
    }),
);
console.log((await Promise.all(answers)).join(" "));
for (const worker of workers) worker.terminate();
