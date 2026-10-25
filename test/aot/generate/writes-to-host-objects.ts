// The programs of writes-to-host-objects that are not written by hand. `bun test/aot/generate.ts writes-to-host-objects <where>` writes them.
// Every way to write, define, delete, test, copy or lock x the members of process | console | Bun | globalThis on which something of Bun's library hangs, and a few on which nothing does,
// THEN A USE of what the run time keeps up behind the member, by another path than its name. ONE MEMBER AND ONE WAY A PROGRAM. No stored outputs: plain Bun is the reference.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const HEAD = `// How a TypeError of the language names what is no function is not what is tested here.
const told = error => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what, run) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
`;
const asyncAttempt = `async function attemptLater(what, run) {
  try {
    console.log(what, String(await run()));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
`;
const PRINTS = 'attempt("console.log", () => console.log("prints"));\n';
const ABORT = 'attempt("an abort", () => {\n  const controller = new AbortController();\n  let heard = 0;\n  controller.signal.addEventListener("abort", () => heard++);\n  controller.abort();\n  return heard;\n});\n';
function later(what: string, body: string) {
  return 'await attemptLater("' + what + '", async () => {\n' + body.split("\n").map(line => "  " + line + "\n").join("") + "});\n";
}
const STREAM = later("a stream of the library", 'const { Readable } = await import("node:stream");\nlet text = "";\nfor await (const piece of Readable.from(["a", "b"])) text += piece;\nreturn text;');
function through(module: string, member: string) {
  return later("the same through " + module, 'const other = await import("' + module + '");\nreturn typeof other.' + member + ";");
}
// holder -> member -> the use by another path
const MEMBERS = {
  process: {
    stdout: PRINTS + through("node:process", "stdout"), stderr: 'attempt("console.error", () => console.error("prints"));\n' + through("node:process", "stderr"), stdin: through("node:process", "stdin"),
    nextTick: STREAM + later("a tick of the library", 'const { nextTick } = await import("node:process");\nreturn typeof nextTick;'),
    env: 'attempt("Bun.env", () => typeof Bun.env);\n', allowedNodeEnvironmentFlags: PRINTS, finalization: PRINTS, loadEnvFile: PRINTS, _rawDebug: PRINTS, mainModule: PRINTS,
    channel: PRINTS, send: PRINTS, disconnect: PRINTS, config: through("node:process", "config"), report: PRINTS, features: PRINTS,
  },
  console: {
    Console: through("node:console", "Console"), _stdout: PRINTS, _stderr: 'attempt("console.error", () => console.error("prints"));\n',
  },
  Bun: {
    $: through("bun", "$"), peek: through("bun", "peek") + later("a peek through bun", 'const { peek } = await import("bun");\nreturn typeof peek === "function" ? peek(Promise.resolve(5)) : "none";'),
    SQL: through("bun", "SQL"), sql: through("bun", "sql"), env: 'attempt("process.env", () => typeof process.env);\n',
    Glob: later("a glob through bun", 'const { Glob } = await import("bun");\nreturn typeof Glob === "function" ? new Glob("*.js").match("a.js") : "none";'), plugin: through("bun", "plugin"),
  },
  globalThis: {
    AbortSignal: ABORT, EventTarget: ABORT,
    ReadableStream: later("the body of a response", 'const piece = await new Response("text").body.getReader().read();\nreturn piece.value.length;'),
    MessagePort: later("a message", 'const { port1, port2 } = new MessageChannel();\nconst heard = new Promise(resolve => (port2.onmessage = event => resolve(event.data)));\nport1.postMessage("sent");\nconst data = await heard;\nport1.close();\nport2.close();\nreturn data;'),
    MessageChannel: PRINTS, BroadcastChannel: PRINTS,
    Performance: 'attempt("a mark", () => {\n  performance.mark("m");\n  return performance.getEntriesByName("m").length;\n});\n',
    setTimeout: later("a timer of the library", 'const timers = await import("node:timers/promises");\nreturn await timers.setTimeout(1, "fired");') + later("Bun.sleep", 'await Bun.sleep(1);\nreturn "slept";'),
    setInterval: later("an interval of the library", 'const timers = await import("node:timers/promises");\nfor await (const value of timers.setInterval(1, "fired")) return value;'),
    WebSocket: PRINTS, Worker: PRINTS,
  },
};
const COPY = 'attempt("the copy", () => typeof copy.@M);\n';
// way -> (what the first line says, the code; @O the holder, @M the member, @K its name as a text)
const WAYS: Record<string, [string, string]> = {
  "a-store": ["is stored to", 'attempt("the store", () => (@O.@M = 1));\n'],
  "a-store-under-a-computed-key": ["is stored to under a key that is put together at run time", 'attempt("the store", () => (@O[key] = 1));\n'],
  "a-store-by-a-pattern": ["is stored to by a destructuring pattern", 'attempt("the store", () => ([@O.@M] = [1]).length);\n'],
  "a-store-by-a-loop": ["is stored to as the variable of a loop", 'attempt("the store", () => {\n  for (@O.@M of [1]);\n  return "done";\n});\n'],
  "a-store-through-an-heir": ["is stored to through an object that inherits from the holder", 'attempt("the store", () => (Object.create(@O).@M = 1));\n'],
  "object-assign": ["is stored to by Object.assign", 'attempt("the store", () => Object.assign(@O, { @M: 1 }) === @O);\n'],
  "object-assign-of-parsed-text": ["is stored to by Object.assign of an object that JSON.parse made", `attempt("the store", () => Object.assign(@O, JSON.parse('{"@M":1}')) === @O);\n`],
  "reflect-set": ["is stored to by Reflect.set", 'attempt("the store", () => Reflect.set(@O, @K, 1));\n'],
  "reflect-set-for-another-receiver": ["is asked for by Reflect.set, which stores into another receiver", 'attempt("the store", () => Reflect.set(@O, @K, 1, {}));\n'],
  "a-definition": ["is defined anew", 'attempt("the definition", () => Object.defineProperty(@O, @K, { value: 1, writable: true, enumerable: true, configurable: true }) === @O);\n'],
  "a-definition-that-keeps-the-value": ["is defined anew by a descriptor without a value, so that it keeps its own", 'attempt("the definition", () => Object.defineProperty(@O, @K, { enumerable: false }) === @O);\n'],
  "define-properties": ["is defined anew by Object.defineProperties", 'attempt("the definition", () => Object.defineProperties(@O, { @M: { value: 1, writable: true, enumerable: true, configurable: true } }) === @O);\n'],
  "reflect-define-property": ["is defined anew by Reflect.defineProperty", 'attempt("the definition", () => Reflect.defineProperty(@O, @K, { value: 1, writable: true, enumerable: true, configurable: true }));\n'],
  "a-deletion": ["is deleted", 'attempt("the deletion", () => delete @O.@M);\n'],
  "a-deletion-under-a-computed-key": ["is deleted under a key that is put together at run time", 'attempt("the deletion", () => delete @O[key]);\n'],
  "reflect-delete-property": ["is deleted by Reflect.deleteProperty", 'attempt("the deletion", () => Reflect.deleteProperty(@O, @K));\n'],
  freeze: ["stands in a holder that is frozen", 'attempt("freeze", () => Object.freeze(@O) === @O);\n'],
  seal: ["stands in a holder that is sealed", 'attempt("seal", () => Object.seal(@O) === @O);\n'],
  "prevent-extensions": ["stands in a holder that is made inextensible", 'attempt("preventExtensions", () => Object.preventExtensions(@O) === @O);\n'],
  "a-store-into-the-frozen-holder": ["is stored to after the holder was frozen", 'attempt("freeze", () => Object.freeze(@O) === @O);\nattempt("the store", () => (@O.@M = 1));\n'],
  "a-spread": ["is copied by a spread of the holder", "const copy = { ...@O };\n" + COPY],
  "object-assign-from-the-holder": ["is copied by Object.assign out of the holder", "const copy = Object.assign({}, @O);\n" + COPY],
  "object-entries": ["is listed by Object.entries of the holder", 'attempt("the entry", () => typeof Object.entries(@O).find(entry => entry[0] === key)?.[1]);\n'],
  "own-descriptors": ["is described by Object.getOwnPropertyDescriptors of the holder", 'attempt("the descriptor", () => typeof Object.getOwnPropertyDescriptors(@O).@M);\n'],
  "a-test-by-in": ["is asked for by the operator in", 'attempt("the test", () => @K in @O);\n'],
  "a-test-under-a-computed-key": ["is asked for by the operator in under a key that is put together at run time", 'attempt("the test", () => key in @O);\n'],
  "has-own": ["is asked for by Object.hasOwn", 'attempt("the test", () => Object.hasOwn(@O, @K));\n'],
  "own-names": ["is named by Object.getOwnPropertyNames of the holder", 'attempt("the names", () => Object.getOwnPropertyNames(@O).includes(@K));\n'],
};
for (const [holder, members] of Object.entries(MEMBERS)) {
  for (const [member, use] of Object.entries(members)) {
    const plain = member.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()).replace(/^-+|-+$/g, "").replaceAll("_", "").replaceAll("$", "dollar").replaceAll("-s-q-l", "-sql-class").replaceAll("s-q-l", "sql-class");
    for (const [way, [says, code]] of Object.entries(WAYS)) {
      let text = "// " + holder + "." + member + " " + says + " and is never read by that name; then the program uses what the run time keeps up behind it.\n" + HEAD;
      if (use.includes("attemptLater")) {
        text += asyncAttempt;
      }
      if (code.replaceAll("@K", "").includes("key")) {
        const half = Math.max(1, Math.floor(member.length / 2));
        text += 'const key = ["' + member.slice(0, half) + '", "' + member.slice(half) + '"].join("");\n';
      }
      text += (code + use).replaceAll("@O", holder).replaceAll("@M", member).replaceAll("@K", '"' + member + '"');
      filesWritten[holder.replaceAll("globalThis", "global-this").toLowerCase() + "-" + plain + "-" + way + ".js"] = text;
    }
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
