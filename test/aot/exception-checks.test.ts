// A Bun built with assertions can ask of every call that may throw whether somebody looked for the exception behind it
// (BUN_JSC_validateExceptionChecks=1), and aborts where nobody did. Any other Bun ignores the variable.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, unsupported, withoutCoreDump } from "./run-programs";

const programs: Record<string, { main: string; files: Record<string, string>; stdout: string; flags?: string[] }> = {
  "async generators that hand on to each other, taken by hand and by for await": {
    main: "main.ts",
    files: {
      "main.ts": `let lines: string[] = [];
const log = (s: string) => { lines.push(s); };
const show = (v: any): string => { try { return v === undefined ? "u" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return "?"; } };
const immediate = (v?: any): Promise<any> => new Promise(resolve => { setImmediate(() => resolve(v)); });
const thenable = (v: any, name: string) => ({ then(resolve: (x: any) => void) { log(name + " then"); resolve(v); } });
const settle = async (running: Promise<any>[]) => { await Promise.allSettled(running); for (let i = 0; i < 8; i++) { await immediate(); for (let j = 0; j < 30; j++) await null; } };
async function* gen2(): AsyncGenerator<any, any, any> { log("gen2 starts"); for (let i = 0; i < 0; i++) {   const got: any = yield i; if (got !== undefined) log("gen2 got " + show(got)); void (async () => { await null; log("gen2b side"); })(); } throw new Error("gen2 failed"); }
async function* gen11(): AsyncGenerator<any, any, any> { log("gen11 starts"); for (let i = 0; i < 2; i++) { await Promise.resolve(1);  const got: any = yield thenable(i, "th"); if (got !== undefined) log("gen11 got " + show(got)); void (async () => { await null; log("gen11b side"); })(); } await null; }
async function* gen18(): AsyncGenerator<any, any, any> { log("gen18 starts"); const r: any = yield* gen2();   }
async function fetch19(it: AsyncGenerator<any, any, any>, n: number): Promise<[any, boolean | undefined]> { Promise.resolve().then(() => log("fetch19a then")); const r = await it.next(Promise.resolve(7)); return [r.value, r.done];  }
async function use17(): Promise<any> { await null; const it = gen18(); try { let n = 0; for (;;) { n++; log("use17f"); const [value, done] = await fetch19(it, n); log("use17 " + show(value) + " " + done); if (done) break; if (n === 3) { const waiting = it.next("ahead"); waiting.then(r => log("use17 ahead " + show(r)), e => log("use17 ahead failed")); } } } catch (e) { log("use17 caught " + (e as Error).message); } log("use17 done"); return "use17"; }
async function* gen21(): AsyncGenerator<any, any, any> { log("gen21 starts"); return yield* gen11(); yield "after";  }
async function fetch22(it: AsyncGenerator<any, any, any>, n: number): Promise<[any, boolean | undefined]> { void (async () => { await null; log("fetch22a side"); })(); try { const { value, done } = await it.next(n); return [value, done]; } finally { log("fetch22 finally"); }  }
async function* use20(): AsyncGenerator<any, any, any> { const it = gen21(); try { let n = 0; for (;;) { n++;  const [value, done] = await fetch22(it, n); yield value; log("use20 " + show(value) + " " + done); if (done) break; if (n === 3) { const waiting = it.next("ahead"); waiting.then(r => log("use20 ahead " + show(r)), e => log("use20 ahead failed")); } } } catch (e) { log("use20 caught " + (e as Error).message); } finally { log("finally"); } log("use20 done"); return "use20"; }
async function scene5() { const running: Promise<any>[] = []; queueMicrotask(() => log("between")); running.push(use17().then(v => log("-> " + show(v)), e => log("-> rejected " + (e as Error).message))); running.push((async () => { const seen: string[] = []; for await (const x of use20()) seen.push(show(x)); return seen.join(); })().then(v => log("-> " + show(v)), e => log("-> rejected " + (e as Error).message))); await settle(running); }
async function* gen26(): AsyncGenerator<any, any, any> { log("gen26 starts"); for (let i = 0; i < 1; i++) { await Promise.resolve(1);  const got: any = yield i; if (got !== undefined) log("gen26 got " + show(got));  } throw new Error("gen26 failed"); }
let shared7: AsyncGenerator<any, any, any> = gen26();
for (const [i, scene] of [scene5].entries()) { lines = []; await scene(); console.log("scene " + i + ": " + lines.join(" | ")); }
`,
    },
    stdout:
      "scene 0: gen21 starts | gen11 starts | between | use17f | gen18 starts | gen2 starts | fetch22a side | fetch19a then | th then | use17 caught gen2 failed | use17 done | -> use17 | fetch22 finally | use20 0 false | gen11 got 2 | fetch22a side | gen11b side | th then | fetch22 finally | use20 1 false | gen11 got 3 | fetch22a side | gen11b side | fetch22 finally | use20 u true | finally | use20 done | -> 0,1,u\n",
  },
  "a store to a typed array past its end, and subarray() of a value of any type": {
    main: "main.ts",
    files: {
      "main.ts": `const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
const view = new Uint8Array(buffer);
buffer.resize(2);
function store(into: Uint8Array, index: number, value: number) {
  into[index] = value;
}
store(view, 5, 1);
store(view, 1, 7);
const any: any = new Uint8Array([1, 2, 3, 4]);
console.log(String(view), String(any.subarray(1)), String(any.subarray(1, 3)));
`,
    },
    stdout: "0,7 2,3,4 2,3\n",
  },
  "a literal with keys that are indices": {
    main: "main.ts",
    files: {
      "main.ts": `const table = { name: "table", 0: "zero", 1: "one", 7: "seven", 4294967294: "the last index" };
console.log(JSON.stringify(table), Object.keys({ a: 1, 2: "two", 1: "one" }).join());
`,
    },
    stdout: `{"0":"zero","1":"one","7":"seven","4294967294":"the last index","name":"table"} 1,2,a\n`,
  },
  "console.assert() that fails": {
    main: "main.ts",
    files: {
      "main.ts": `console.assert(true, "not shown");\nconsole.assert(false, "shown");\nconsole.log("after");\n`,
    },
    stdout: "after\n",
  },
  "the message about an argument of the wrong type": {
    main: "main.ts",
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
class Odd {}
for (const value of [{}, new Odd(), Object.create(null), { a: 1 }]) {
  try {
    new EventEmitter().setMaxListeners(value as number);
  } catch (error) {
    console.log((error as Error).message.split(". ")[1]);
  }
}
`,
    },
    stdout:
      "Received an instance of Object\nReceived an instance of Odd\nReceived [Object: null prototype] {}\nReceived an instance of Object\n",
  },
  "module.parent and module.children": {
    main: "main.cjs",
    files: {
      "main.cjs": `const child = require("./child.cjs");\nconsole.log(child.parentIsMain, module.children.length, module.children.length, module.parent);\n`,
      "child.cjs": `exports.parentIsMain = module.parent === require.main;\n`,
    },
    stdout: "true 1 1 null\n",
  },
  "every module of undici's binding": {
    main: "main.ts",
    files: {
      "main.ts": `import { Headers, Request, Response } from "undici";\nconsole.log(typeof Headers, typeof Request, typeof Response);\n`,
    },
    stdout: "function function function\n",
  },
  "more pieces of a wide text than a string under construction holds apart": {
    main: "main.ts",
    files: {
      "main.ts": `const text = "\\u20ac1\\u20ac2\\u20ac3\\u20ac4\\u20ac5".repeat(400);
function pieces(from: string, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += i + ":" + from.slice(i, i + 3) + ";";
  return out;
}
const joined = pieces(text, 3000);
console.log(joined.length, joined.slice(0, 24), joined.slice(-12));
`,
    },
    stdout: "25890 0:\u20ac1\u20ac;1:1\u20ac2;2:\u20ac2\u20ac;3:2\u20ac3; 5\u20ac;2999:5\u20ac1;\n",
  },
  "keys put together from parts that are longer than the longest key that is kept": {
    main: "main.ts",
    flags: ["--aot-limit=MaxCachedKeyLength:2"],
    files: {
      "main.ts": `const table: Record<string, number> = {};
function put(prefix: string, count: number): void {
  for (let i = 0; i < count; i++) table[prefix + i] = i;
}
put("key", 3);
put("a-rather-longer-key-", 3);
put("", 3);
console.log(Object.keys(table).join());
`,
    },
    stdout: "0,1,2,key0,key1,key2,a-rather-longer-key-0,a-rather-longer-key-1,a-rather-longer-key-2\n",
  },
  "a class below one whose accessor is named constructor": {
    main: "main.js",
    files: {
      "main.js": `class OnlySetter { set ["constructor"](value) {} }
class Below extends OnlySetter {}
console.log(new Below().constructor === Below, new OnlySetter().constructor);
`,
    },
    stdout: "true undefined\n",
  },
  "evaluated text reads a member of console that was left out": {
    main: "main.js",
    files: {
      "main.js": `const decoded = text => Buffer.from(text).toString();
console.log((0, eval)(decoded("typeof console.Console")));
`,
    },
    stdout: "function\n",
  },
};

describe.concurrent("compile/aot/exception checks", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [name, { main, files, stdout, flags = [] }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-exception-checks", files);
          const root = String(dir);
          const executable = join(root, "program");
          built(
            await spawned(
              [bunExe(), "build", "--compile", "--aot", ...flags, main, "--outfile", executable],
              root,
              bunEnv,
            ),
          );
          const ran = await spawned(withoutCoreDump([executable]), root, {
            ...bunEnv,
            BUN_JSC_validateExceptionChecks: "1",
          });
          expect({ signal: ran.signal, stderr: ran.signal ? ran.stderr : "", stdout: ran.stdout }).toEqual({
            signal: null,
            stderr: "",
            stdout,
          });
        }),
      600_000,
    );
  }
});
