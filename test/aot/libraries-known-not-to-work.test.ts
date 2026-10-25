// docs/bundler/aot-compatibility.mdx, "Libraries that are known not to work": a table of packages, what each does, and what you see in an executable.
// Here each row has a small program that does what the package does. The program runs under plain Bun, is built with `bun compile`, and the
// executable has to print the messages of the row, letter for letter. A row without a program fails, and so does a program without a row.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { slot, unsupported } from "./run-programs";

const page = readFileSync(join(import.meta.dir, "../../docs/bundler/aot-compatibility.mdx"), "utf8");
const section = page.slice(page.indexOf("\n## Libraries that are known not to work\n")).split("\n## ")[1];

const anchors = new Set(
  Array.from(
    page.matchAll(/^#{2,3} (.+)$/gm),
    ([, title]) =>
      "#" +
      title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replaceAll(" ", "-"),
  ),
);

// Where the table cuts a TypeError short with `...`, it ends like the one that the section prints in full.
const whole = /```txt\n(TypeError: Cannot assign to Function\.prototype\.call\$0)( because .*)\n```/.exec(section)!;
const ending = whole[2];

const codeIn = (cell: string) => Array.from(cell.matchAll(/`([^`]+)`/g), ([, code]) => code.replaceAll("\\|", "|"));
const rows = section
  .split("\n")
  .filter(line => line.startsWith("| `"))
  .map(line => line.split(/(?<!\\)\|/).map(cell => cell.trim()))
  .map(([, packages, does, sees, rule]) => ({
    name: codeIn(packages)[0],
    line: codeIn(does).at(-1)!,
    sees: codeIn(sees)
      .filter(code => /^(\w*Error|error|warn): /.test(code))
      .map(code =>
        code.startsWith("TypeError: Cannot ") && code.endsWith(" ...") ? code.slice(0, -4) + ending : code,
      ),
    rule: /\]\((#[a-z0-9-]+)\)/.exec(rule)?.[1],
  }));

// `steps` keeps the build from knowing that a write runs. A write that always runs stops the build, which is what one row is about.
const inSteps = (...code: string[]) =>
  `const steps = [${code.map(each => `function () { ${each} }`).join(", ")}];\nfor (const step of steps) step();\n`;

type Program = {
  files: Record<string, string>;
  /** What plain Bun prints. */
  plain: string;
  /** What the executable prints to stdout, where the row has no message. */
  compiled?: string;
  /** The messages come from the build, which fails. */
  stopsBuild?: true;
};

const programs: Record<string, Program> = {
  "sass": {
    files: {
      "main.js":
        inSteps("Function.prototype.call$0 = function () { return this(); };") + `console.log((() => 1).call$0());`,
    },
    plain: "1\n",
  },
  "private": {
    files: {
      "main.js": `
        "use strict";
        const originalDefProp = Object.defineProperty;
        function defProp(obj, name, value) {
          try { originalDefProp.call(Object, obj, name, { value }); } catch { obj[name] = value; }
        }
        function makeSafeToCall(fun) { defProp(fun, "call", fun.call); defProp(fun, "apply", fun.apply); return fun; }
        const hasOwn = makeSafeToCall(Object.prototype.hasOwnProperty);
        console.log(hasOwn.call({ a: 1 }, "a"));`,
    },
    plain: "true\n",
  },
  "zone.js": {
    files: {
      "main.js": `
        function patchThen(Ctor) {
          const proto = Ctor.prototype, originalThen = proto.then;
          proto["__zone_symbol__then"] = originalThen;
          Ctor.prototype.then = function (a, b) { return originalThen.call(this, a, b); };
        }
        patchThen(Promise);
        Promise.resolve(1).then(console.log);`,
    },
    plain: "1\n",
  },
  "ses": {
    files: {
      "main.js": `
        const { getOwnPropertyDescriptors, defineProperties } = Object;
        const replacements = { get byteLength() { return 7; }, sliceToImmutable() { return this; } };
        defineProperties(ArrayBuffer.prototype, getOwnPropertyDescriptors(replacements));
        console.log(new ArrayBuffer(1).byteLength);`,
    },
    plain: "7\n",
  },
  "asciidoctor": {
    files: {
      "main.js": `
        function bridge(native, klass) { Object.setPrototypeOf(native.prototype, klass.prototype); }
        class RubyObject { inspect() { return "#<" + this.constructor.name + ">"; } }
        for (const native of [Boolean, Number, String]) bridge(native, RubyObject);
        console.log(true.inspect());`,
    },
    plain: "#<Boolean>\n",
  },
  "should": {
    files: {
      "main.js": `
        try {
          Object.defineProperty(Object.prototype, "should", { get() { return { be: this }; }, configurable: true });
        } catch {}
        console.log((5).should.be == 5);`,
    },
    plain: "true\n",
  },
  "chai": {
    files: {
      "main.js":
        `function loadShould() { Object.defineProperty(Object.prototype, "should", { get() { return 1; }, configurable: true }); }\n` +
        inSteps("loadShould();") +
        `console.log((5).should);`,
    },
    plain: "1\n",
  },
  "must": {
    files: {
      "main.js":
        inSteps(`Object.defineProperty(Object.prototype, "must", { get() { return 1; }, configurable: true });`) +
        `console.log((5).must);`,
    },
    plain: "1\n",
  },
  "es5-shim": {
    files: {
      "main.js": `
        function defineProperties(object, map) {
          for (const name in map) Object.defineProperty(object, name, { configurable: true, writable: true, value: map[name] });
        }
        defineProperties(Array.prototype, { forEach: function forEach(f) { for (let i = 0; i < this.length; i++) f(this[i]); } });
        [1].forEach(console.log);`,
    },
    plain: "1\n",
  },
  "es6-shim": {
    files: {
      "main.js": `
        function defineProperty(object, name, value) { Object.defineProperty(object, name, { configurable: true, writable: true, value }); }
        defineProperty(RegExp.prototype, "toString", function toString() { return "/" + this.source + "/"; });
        console.log(String(/a/g));`,
    },
    plain: "/a/\n",
  },
  "core-js": {
    files: {
      "main.js": `
        function hide(object, key, value) { return Object.defineProperty(object, key, { configurable: true, writable: true, value }); }
        function $export(name, source) { for (const key in source) hide(globalThis[name].prototype, key, source[key]); }
        $export("Function", { part() { return this.bind(undefined, ...arguments); } });
        console.log(Math.max.part(2)(1));`,
    },
    plain: "2\n",
  },
  "harmony-reflect": {
    files: {
      "main.js":
        inSteps(
          "const original = Object.preventExtensions; Object.preventExtensions = function (subject) { return original(subject); };",
        ) + `console.log(Object.isExtensible(Object.preventExtensions({})));`,
    },
    plain: "false\n",
  },
  "sugar": {
    files: {
      "main.js": `
        function setProperty(target, name, value) { Object.defineProperty(target, name, { value, configurable: true, writable: true }); }
        function extendNative(target, source) { for (const name in source) setProperty(target, name, source[name]); }
        extendNative(Object, { values(o) { return Object.keys(o).map(key => o[key]); } });
        console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "collections": {
    files: {
      "main.js":
        inSteps("Object.values = function (object) { return Object.keys(object).map(key => object[key]); };") +
        `console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "prototype": {
    files: {
      "main.js": `
        function extend(destination, source) { for (const property in source) destination[property] = source[property]; return destination; }
        extend(Object, { values(o) { return Object.keys(o).map(key => o[key]); } });
        console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "url-polyfill": {
    files: {
      "main.js": `
        const proto = URLSearchParams.prototype;
        if (typeof proto._fromString !== "function") Object.defineProperty(proto, "_fromString", { value(text) { return text; } });
        console.log(new URLSearchParams()._fromString("a"));`,
    },
    plain: "a\n",
  },
  "array.prototype.map": {
    files: {
      "main.js": `
        function define(object, map) { for (const name in map) Object.defineProperty(object, name, { configurable: true, writable: true, value: map[name] }); }
        define(Array.prototype, { map: function map(f) { const out = []; for (let i = 0; i < this.length; i++) out[i] = f(this[i]); return out; } });
        console.log([1].map(x => x + 1));`,
    },
    plain: "[ 2 ]\n",
  },
  "set.prototype.union": {
    files: {
      "main.js": `
        function addIterator(prototype) {
          Object.defineProperty(prototype, Symbol.iterator, { configurable: true, writable: true, value() { return this; } });
        }
        addIterator(Object.getPrototypeOf(new Set().values()));
        console.log([...new Set([1]).values()]);`,
    },
    plain: "[ 1 ]\n",
  },
  "string.prototype.matchall": {
    files: {
      "main.js": `
        const symbol = Symbol.matchAll;
        if (!Object.getOwnPropertyDescriptor(Symbol, symbol)) Object.defineProperty(Symbol, symbol, { value: symbol });
        console.log(Symbol[symbol] === symbol);`,
    },
    plain: "true\n",
  },
  "promise": {
    files: {
      "main.js":
        inSteps("Promise.prototype.done = function (a, b) { this.then(a, b); };") +
        `Promise.resolve(1).done(console.log);`,
    },
    plain: "1\n",
  },
  "timezone-mock": {
    files: {
      "main.js": `
        const original = Object.prototype.toString;
        exports.register = function () { Object.prototype.toString = function () { return original.call(this); }; };
        exports.register();
        console.log(String({}));`,
    },
    plain: "[object Object]\n",
  },
  // As in the package: shimmer exports a function with the wrappers as members, and one of the objects it wraps is a prototype found at run time.
  "async-listener": {
    files: {
      "main.js": `
        const shimmer = require("./shimmer.js"), wrap = shimmer.wrap, massWrap = shimmer.massWrap;
        function activator(original) {
          return function () { console.log("wrapped"); return original.apply(this, arguments); };
        }
        wrap(process, "nextTick", activator);
        const asynchronizers = ["setTimeout", "setInterval"];
        if (global.setImmediate) asynchronizers.push("setImmediate");
        massWrap(global, asynchronizers, activator);
        massWrap(require("node:dns"), ["lookup", "resolve"], activator);
        massWrap(require("node:fs"), ["stat", "readdir"], activator);
        const proto = Object.getPrototypeOf(require("node:zlib").Deflate.prototype);
        if (proto._transform) wrap(proto, "_transform", activator);
        else if (proto.write && proto.flush && proto.end) massWrap(proto, ["write", "flush", "end"], activator);
        setTimeout(() => console.log("ran"), 1);`,
      "shimmer.js": `
        function defineProperty(obj, name, value) {
          const enumerable = !!obj[name] && obj.propertyIsEnumerable(name);
          Object.defineProperty(obj, name, { configurable: true, enumerable, writable: true, value });
        }
        function shimmer() {}
        function wrap(nodule, name, wrapper) {
          if (!nodule || !nodule[name]) return;
          const original = nodule[name], wrapped = wrapper(original, name);
          defineProperty(wrapped, "__original", original);
          defineProperty(nodule, name, wrapped);
          return wrapped;
        }
        function massWrap(nodules, names, wrapper) {
          if (!nodules) return;
          else if (!Array.isArray(nodules)) nodules = [nodules];
          nodules.forEach(function (nodule) {
            names.forEach(function (name) {
              wrap(nodule, name, wrapper);
            });
          });
        }
        shimmer.wrap = wrap;
        shimmer.massWrap = massWrap;
        module.exports = shimmer;`,
    },
    plain: "wrapped\nran\n",
  },
  "pirates": {
    files: {
      "main.js": `
        const Module = require("node:module");
        const oldLoader = Module._extensions[".js"];
        Module._extensions[".js"] = function newLoader(mod, filename) { return oldLoader(mod, filename); };
        console.log(require("./other.js"));`,
      "other.js": `module.exports = "one";`,
    },
    plain: "one\n",
  },
  "module-alias": {
    files: {
      "main.js": `
        const Module = require("node:module");
        const oldResolveFilename = Module._resolveFilename;
        Module._resolveFilename = function (request, ...rest) {
          return oldResolveFilename.call(this, request.replace(/^@lib/, __dirname + "/lib"), ...rest);
        };
        console.log(require("@lib/other.js"));`,
      "lib/other.js": `module.exports = "one";`,
    },
    plain: "one\n",
  },
  "require-in-the-middle": {
    files: {
      "main.js": `
        const Module = require("node:module");
        const original = Module.prototype.require;
        Module.prototype.require = function (id) { console.log("hooked", id); return original.call(this, id); };
        console.log(typeof require("node:http").request);`,
    },
    plain: "hooked node:http\nfunction\n",
    compiled: "function\n",
  },
  "clear-module": {
    files: {
      "main.js": `
        console.log(require("./counter.js"));
        delete require.cache[require.resolve("./counter.js")];
        console.log(require("./counter.js"));`,
      "counter.js": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nmodule.exports = globalThis.runs;`,
    },
    plain: "1\n2\n",
    compiled: "1\n1\n",
  },
  "@js-temporal/polyfill": {
    files: {
      "main.js": `
        function toTemporalInstant() { return this.getTime(); }
        Date.prototype.toTemporalInstant = toTemporalInstant;
        console.log(new Date(5).toTemporalInstant());`,
    },
    plain: "5\n",
    stopsBuild: true,
  },
};

const env = { ...bunEnv, NO_COLOR: "1" };

describe.skipIf(!!unsupported)("libraries that are known not to work", () => {
  test("every row has a program, a line of the package's code and a rule on the page", () => {
    expect(rows.map(row => row.name).sort()).toEqual(Object.keys(programs).sort());
    for (const { name, line, rule } of rows) {
      expect({ name, line: typeof line }).toEqual({ name, line: "string" });
      expect({ name, rule: anchors.has(rule!) }).toEqual({ name, rule: true });
    }
  });

  test.concurrent.each(rows.filter(row => row.name in programs))(
    "$name",
    async ({ name, sees, rule }) => {
      const { files, plain, compiled, stopsBuild } = programs[name];
      using dir = tempDir("aot-known-libraries", { "package.json": `{ "name": "program" }`, ...files });
      const cwd = String(dir);
      const [before, build] = await Promise.all([
        run([bunExe(), "run", "main.js"], cwd, env),
        slot(() => run([bunExe(), "compile", "main.js", "--outfile", "program"], cwd, env)),
      ]);
      expect({ stdout: before.stdout, exitCode: before.exitCode }).toEqual({ stdout: plain, exitCode: 0 });

      // A message that still ends with `...` is the start of a line. Any other is a whole line.
      const missingIn = (text: string, messages: string[]) => {
        const lines = text.split("\n").map(line => line.trim());
        return messages.filter(message =>
          message.endsWith(" ...")
            ? !lines.some(line => line.startsWith(message.slice(0, -4)))
            : !lines.includes(message),
        );
      };
      if (stopsBuild) {
        expect({ missing: missingIn(build.stderr, sees), said: build.stderr }).toEqual({
          missing: [],
          said: build.stderr,
        });
        expect(build.exitCode).toBe(1);
        return;
      }
      expect({ exitCode: build.exitCode, stderr: build.exitCode ? build.stderr : "" }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      const warnings = sees.filter(message => message.startsWith("warn: "));
      expect({ missing: missingIn(build.stderr, warnings), said: build.stderr }).toEqual({
        missing: [],
        said: build.stderr,
      });

      const after = await run([join(cwd, isWindows ? "program.exe" : "program")], cwd, env);
      if (compiled !== undefined) {
        expect(sees).toEqual([]);
        expect({ stdout: after.stdout, exitCode: after.exitCode }).toEqual({ stdout: compiled, exitCode: 0 });
        return;
      }
      expect(sees.length).toBeGreaterThan(warnings.length);
      const atRunTime = sees.filter(message => !warnings.includes(message));
      expect({ missing: missingIn(after.stderr, atRunTime), said: after.stderr }).toEqual({
        missing: [],
        said: after.stderr,
      });
      expect(after.exitCode).toBe(1);

      // Under `bun run --aot` the program runs from its source, with the built-in objects read-only as in an executable.
      const fromSource = await slot(() => run([bunExe(), "run", "--aot", "main.js"], cwd, env));
      if (rule === "#loader-hooks" || name === "async-listener") expect(fromSource.stdout).toBe(plain);
      else if (name !== "should")
        expect({ missing: missingIn(fromSource.stderr, atRunTime), said: fromSource.stderr }).toEqual({
          missing: [],
          said: fromSource.stderr,
        });
    },
    120_000,
  );
});
