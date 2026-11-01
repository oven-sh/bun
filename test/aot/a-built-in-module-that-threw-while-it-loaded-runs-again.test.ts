import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = casesOfOneRun("a-built-in-module-that-threw-while-it-loaded-runs-again", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

function runsAsPlain(title: string, printed: string, body: string, files: Record<string, string> = {}) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      function load(module) {
        try {
          return typeof require(module);
        } catch (error) {
          return error.name + ": " + error.message;
        }
      }
      test("${name}", async () => {${body.replaceAll("console.log(", "say(")}
      });`,
    files,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain).toEqual({ result: "pass", printed });
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "node:zlib under an Object.keys that answers nonsense, and then under the real one",
  "TypeError function\n",
  `
        const real = Object.keys;
        let first, second;
        Object.keys = () => ["nonsense"];
        try { first = typeof require("node:zlib").gzipSync; } catch (error) { first = error.name; } finally { Object.keys = real; }
        try { second = typeof require("node:zlib").gzipSync; } catch (error) { second = error.name; }
        console.log(first, second);`,
);

runsAsPlain(
  "each require() runs the body from its start until one run ends",
  "Error: call 1 | Error: call 3 | object | object | hello\n",
  `
        const real = Object.freeze;
        let calls = 0;
        Object.freeze = function (object) {
          if (++calls === 1 || calls === 3) throw new Error("call " + calls);
          return real(object);
        };
        const loads = [load("node:zlib"), load("node:zlib"), load("node:zlib"), load("node:zlib")];
        Object.freeze = real;
        const zlib = require("node:zlib");
        console.log(loads.join(" | "), "|", String(zlib.gunzipSync(zlib.gzipSync("hello"))));`,
);

runsAsPlain(
  "the second run defines accessors that cannot be configured on a function of its own",
  "Error: thrown | function | 5 10 true\n",
  `
        const real = Object.assign;
        let armed = true;
        Object.assign = function (...all) {
          if (armed && typeof all[0] === "function" && all[0].name === "EventEmitter") {
            armed = false;
            throw new Error("thrown");
          }
          return Reflect.apply(real, this, all);
        };
        const loads = [load("node:events"), load("node:events")];
        Object.assign = real;
        const EventEmitter = require("node:events");
        const emitter = new EventEmitter();
        let sum = 0;
        emitter.on("x", value => { sum += value; });
        emitter.emit("x", 2);
        emitter.emit("x", 3);
        console.log(loads.join(" | "), "|", sum, EventEmitter.defaultMaxListeners, emitter instanceof EventEmitter);`,
);

runsAsPlain(
  "a class that the first run had evaluated extends what the second run makes",
  "Error: thrown | function | true true true true true\n",
  `
        const real = Object.defineProperties;
        let armed = true;
        Object.defineProperties = function (...all) {
          if (armed && typeof all[0] === "function" && all[0].name === "EventEmitter") {
            armed = false;
            throw new Error("thrown");
          }
          return Reflect.apply(real, this, all);
        };
        const loads = [load("node:events"), load("node:events")];
        Object.defineProperties = real;
        const EventEmitter = require("node:events");
        const { EventEmitterAsyncResource } = EventEmitter;
        const resource = new EventEmitterAsyncResource({ name: "r" });
        const { Readable } = require("node:stream");
        console.log(
          loads.join(" | "),
          "|",
          resource instanceof EventEmitter,
          Object.getPrototypeOf(EventEmitterAsyncResource) === EventEmitter,
          Object.getPrototypeOf(EventEmitterAsyncResource.prototype) === EventEmitter.prototype,
          Object.getPrototypeOf(new EventEmitter()) === EventEmitter.prototype,
          Readable.from(["a"]) instanceof EventEmitter,
        );`,
);

for (const [title, specifier] of [
  ["import() of the module", "node:zlib"],
  ["import() of a file that imports the module", "./user.js"],
]) {
  runsAsPlain(
    `${title} gets what the first load threw for good, and require() does not`,
    "TypeError TypeError object TypeError\n",
    `
        const real = Object.keys;
        const imported = async () => {
          try {
            return typeof (await import("${specifier}")).gzipSync;
          } catch (error) {
            return error.name;
          }
        };
        Object.keys = () => ["nonsense"];
        const first = await imported();
        Object.keys = real;
        console.log(first, await imported(), load("node:zlib"), await imported());`,
    { "user.js": `export { gzipSync } from "node:zlib";` },
  );
}
