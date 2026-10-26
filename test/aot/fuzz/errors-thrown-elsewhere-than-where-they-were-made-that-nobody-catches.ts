// An error is made in one function and thrown in another, at once or later, and nobody catches it: it leaves a timer, a tick, a microtask, a listener, a promise or the module itself.
// The program starts itself once for each case and prints what that process wrote about the error: its name and message, its frames, and the exit code.
import type { Random } from "./random";

// How the error comes to be. Each is the body of `function make(n)`.
const made = [
  `return new Error("made " + n);`,
  `return new TypeError("made " + n);`,
  `return Object.assign(new RangeError("made " + n), { code: "E_MADE" });`,
  `return new Error("made " + n, { cause: new Error("cause") });`,
  `return new (class Own extends Error {\nname = "Own";\n})("made " + n);`,
  `try {\nnull.missing;\n} catch (error) {\nreturn error;\n}`,
  `try {\nundefinedName;\n} catch (error) {\nreturn error;\n}`,
  `try {\nJSON.parse("{");\n} catch (error) {\nreturn error;\n}`,
  `try {\n[].reduce((a, b) => a);\n} catch (error) {\nreturn error;\n}`,
  `const error = new Error("made " + n);\nerror.stack;\nreturn error;`,
  `const error = new Error("made " + n);\nError.captureStackTrace(error);\nreturn error;`,
  `const error = { message: "no error " + n };\nError.captureStackTrace(error);\nreturn error;`,
  `return [1].map(() => new Error("made " + n))[0];`,
  `return Reflect.construct(Error, ["made " + n]);`,
  `return Error("made " + n);`,
  `return new AggregateError([new Error("inner")], "made " + n);`,
  `return "a text " + n;`,
  `return { toString() {\nreturn "an object " + n;\n} };`,
] as const;

// How it is thrown. Each is the body of `function toss(error)`.
const thrown = [
  `throw error;`,
  `console.log("before the throw");\nthrow error;`,
  `if (error) throw error;\nreturn 1;`,
  `try {\nthrow error;\n} finally {\ncount++;\n}`,
  `try {\nthrow error;\n} catch (caught) {\nthrow caught;\n}`,
  `try {\nthrow new Error("another");\n} catch {\nthrow error;\n}`,
  `[1].forEach(() => {\nthrow error;\n});`,
  `return deeper(error);`,
  `const result = deeper(error);\nreturn result;`,
  `new (class {\nconstructor() {\nthrow error;\n}\n})();`,
  `({ get now() {\nthrow error;\n} }).now;`,
  `Reflect.apply(deeper, undefined, [error]);`,
  `deeper.call(undefined, error);`,
  `switch (typeof error) {\ndefault:\nthrow error;\n}`,
  `throw (count++, error);`,
] as const;

// Who calls. RUN is a call that makes the error and throws it; LATE throws one that was made before.
const callers = [
  `setTimeout(function timer() {\nRUN\n}, 1);`,
  `setTimeout(() => {\nRUN\n}, 1);`,
  `setImmediate(function immediate() {\nRUN\n});`,
  `process.nextTick(function tick() {\nRUN\n});`,
  `queueMicrotask(function job() {\nRUN\n});`,
  `Promise.resolve().then(function then() {\nRUN\n});`,
  `(async function waits() {\nawait 1;\nRUN\n})();`,
  `new Promise(function executor() {\nRUN\n});`,
  `const emitter = new EventEmitter();\nemitter.on("go", function listener() {\nRUN\n});\nsetTimeout(() => emitter.emit("go"), 1);`,
  `const emitter = new EventEmitter();\nemitter.once("go", function listener() {\nRUN\n});\nprocess.nextTick(() => emitter.emit("go"));`,
  `const emitter = new EventEmitter();\nsetTimeout(() => emitter.emit("error", make(1)), 1);`,
  `const target = new EventTarget();\ntarget.addEventListener("go", function listener() {\nRUN\n});\nsetTimeout(() => target.dispatchEvent(new Event("go")), 1);`,
  `const { port1, port2 } = new MessageChannel();\nport1.onmessage = function message() {\nport1.close();\nRUN\n};\nport2.postMessage(1);`,
  `process.on("exit", function atExit() {\nRUN\n});`,
  `process.on("beforeExit", function beforeExit() {\nRUN\n});`,
  `const interval = setInterval(function turn() {\nclearInterval(interval);\nRUN\n}, 1);`,
  `RUN`,
  `await 1;\nRUN`,
  `Promise.reject(make(1));`,
  `setTimeout(toss, 1, make(1));`,
  `process.nextTick(toss, make(1));`,
  `setTimeout(toss.bind(undefined, make(1)), 1);`,
] as const;

const runs = [
  `toss(make(1));`,
  `toss(early);`,
  `const error = make(1);\ncount++;\ntoss(error);`,
  `return toss(make(1));`,
  `toss(kept[0]);`,
] as const;

export function generate(random: Random): string {
  const count = random.between(4, 8);
  const cases: string[] = [];
  for (let index = 0; index < count; index++) {
    const caller = random.pick(callers);
    let run: string = random.pick(runs);
    // A `return` needs a function around it.
    if (/^(RUN|await 1;\nRUN)$/.test(caller) && run.startsWith("return")) run = `toss(make(1));`;
    cases.push(
      [
        `async function case${index}() {`,
        `function make(n) {\n${random.pick(made)}\n}`,
        `function deeper(error) {\n${random.pick([`throw error;`, `count++;\nthrow error;`, `return deepest(error);`])}\n}`,
        `function deepest(error) {\nthrow error;\n}`,
        `function toss(error) {\n${random.pick(thrown)}\n}`,
        `const early = make(0);`,
        `const kept = [make(2)];`,
        random.chance(0.15)
          ? `process.on("uncaughtException", function handler(error, origin) {\nconsole.log("handler", origin, String(error?.message ?? error));\n});`
          : ``,
        random.chance(0.1)
          ? `process.on("unhandledRejection", function handler(error) {\nconsole.log("handler", String(error?.message ?? error));\n});`
          : ``,
        caller.replace("RUN", () => run),
        `}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return `import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
let count = 0;
${cases.join("\n")}
const cases = [${cases.map((_, index) => `case${index}`).join(", ")}];
const isExecutable = process.argv[1].includes("$bunfs") || process.argv[1].includes("~BUN");
const asked = process.argv[2];
if (asked !== undefined) await cases[Number(asked)]();
else
  for (let index = 0; index < cases.length; index++) {
    const child = spawnSync(process.execPath, [...(isExecutable ? [] : [process.argv[1]]), String(index)], { encoding: "utf8" });
    console.log("case", index, "exit", child.status, child.signal);
    for (const line of child.stdout.split("\\n")) if (line) console.log("  out:", line);
    // The lines of the source and the line with the version of Bun are left out; a path is cut to the name of the file, a place in the library to its module.
    // A position without a file lies in the text of a built-in function, which is no part of the program: the name of the frame stays, the position goes.
    for (const line of child.stderr.split("\\n"))
      if (/^\\s+at |^\\S*(Error|Own|error)\\b|^\\s+(code|cause|\\[cause\\]|\\[errors\\])\\b/.test(line)) console.log("  err:", line.replace(/\\(?[^\\s(]*[\\\\/]([^\\\\/:]+:\\d+:\\d+)\\)?/, "$1").replace(/\\((node:[\\w\\/]+|native):\\d+(:\\d+)?\\)/, "($1)").replace(/ \\(\\d+:\\d+\\)$/, ""));
  }
`;
}
