// libraries-known-not-to-work.md: a table of packages, what each does, and what you see in an executable. docs/compiler/libraries.mdx names the same packages.
// Here each row has a small program that does what the package does. The program runs under plain Bun, is built with `bun compile`, and the
// executable has to print the messages of the row, letter for letter. A row without a program fails, and so does a program without a row.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
const section = read("libraries-known-not-to-work.md");
const libraries = read("../../docs/compiler/libraries.mdx");

const anchors = new Set(
  Array.from(
    (read("../../docs/compiler/compatibility.mdx") + libraries).matchAll(/^#{2,3} (.+)$/gm),
    ([, title]) =>
      "#" +
      title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replaceAll(" ", "-"),
  ),
);

// Where the table cuts a TypeError short with `...`, it ends like the one that the section prints in full.
const whole = /```txt\n(TypeError: Cannot assign to Promise\.prototype\.then)( because .*)\n```/.exec(section)!;
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
  "private": {
    files: {
      "main.js": `console.log(require("./private.js").hasOwn.call({ a: 1 }, "a"));`,
      "private.js": `
        "use strict";
        // Names that a file keeps to itself are told to nobody who lists names.
        const kept = new Set(["kept to itself"]), list = Object.getOwnPropertyNames, own = Object.prototype.hasOwnProperty;
        for (const name of ["apply", "call"]) Object.defineProperty(own, name, { value: own[name] });
        exports.hasOwn = own;
        Object.getOwnPropertyNames = function (object) { return list(object).filter(name => !kept.has(name)); };`,
    },
    plain: "true\n",
  },
  "zone.js": {
    files: {
      "main.js": `
        function lay(kind, before) {
          kind.prototype["then as it was"] = before;
          kind.prototype.then = function (...ways) { return Reflect.apply(before, this, ways); };
        }
        lay(Promise, Promise.prototype.then);
        Promise.resolve(1).then(console.log);`,
    },
    plain: "1\n",
  },
  "ses": {
    files: {
      "main.js": `
        const laid = Object.getOwnPropertyDescriptors({ get byteLength() { return 7; }, itself() { return this; } });
        Object.defineProperties(ArrayBuffer.prototype, laid);
        console.log(new ArrayBuffer(1).byteLength);`,
    },
    plain: "7\n",
  },
  "asciidoctor": {
    files: {
      "main.js": `
        class Told { tell() { return "#<" + this.constructor.name + ">"; } }
        function raise(kind, above) { Object.setPrototypeOf(kind.prototype, above.prototype); }
        for (const kind of [Boolean, Number, String]) raise(kind, Told);
        console.log(true.tell());`,
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
        `function lay() { Object.defineProperty(Object.prototype, "should", { get() { return 1; }, configurable: true }); }\n` +
        inSteps("lay();") +
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
        function lay(target, members) {
          for (const name in members) Object.defineProperty(target, name, { value: members[name], writable: true, configurable: true });
        }
        lay(Array.prototype, { forEach(each) { let at = 0; while (at < this.length) each(this[at++]); } });
        [1].forEach(console.log);`,
    },
    plain: "1\n",
  },
  "es6-shim": {
    files: {
      "main.js": `
        function lay(target, name, value) { Object.defineProperty(target, name, { value, writable: true, configurable: true }); }
        lay(RegExp.prototype, "toString", function () { return ["", this.source, ""].join("/"); });
        console.log(String(/a/g));`,
    },
    plain: "/a/\n",
  },
  "core-js": {
    files: {
      "main.js": `
        function lay(target, name, value) { Object.defineProperty(target, name, { value, writable: true, configurable: true }); }
        function widen(kind, members) { for (const name of Object.keys(members)) lay(globalThis[kind].prototype, name, members[name]); }
        widen("Function", { begun(...first) { return (...more) => this(...first, ...more); } });
        console.log(Math.max.begun(2)(1));
        const steps = { next() { return this.at < this.end ? { done: false, value: this.at++ } : { done: true, value: undefined }; } };
        function count(kind) { lay(kind.prototype, Symbol.iterator, function () { return { __proto__: steps, at: 0, end: +this }; }); }
        count(Number);
        console.log([...3].join());`,
    },
    plain: "2\n0,1,2\n",
  },
  "harmony-reflect": {
    files: {
      "main.js":
        inSteps(
          "const before = Object.preventExtensions; Object.preventExtensions = function (thing) { return before(thing); };",
        ) + `console.log(Object.isExtensible(Object.preventExtensions({})));`,
    },
    plain: "false\n",
  },
  "sugar": {
    files: {
      "main.js": `
        function put(target, name, value) { Object.defineProperty(target, name, { configurable: true, value, writable: true }); }
        function widen(target, members) { for (const name in members) put(target, name, members[name]); }
        widen(Object, { values(row) { const found = []; for (const key in row) found.push(row[key]); return found; } });
        console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "collections": {
    files: {
      "main.js":
        inSteps(
          "Object.values = function (row) { const found = []; for (const key in row) found.push(row[key]); return found; };",
        ) + `console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "minizlib": {
    files: {
      "main.js": `
        const { Buffer } = require("buffer");
        const join = Buffer.concat;
        function partsOf(parts) {
          Buffer.concat = given => given;
          try { return Buffer.concat(parts).length; } finally { Buffer.concat = join; }
        }
        console.log(partsOf([Buffer.from("a"), Buffer.from("b")]));`,
    },
    plain: "2\n",
  },
  "prototype": {
    files: {
      "main.js": `
        function layOnto(target, members) { for (const name of Object.keys(members)) target[name] = members[name]; }
        layOnto(Object, { values(row) { const found = []; for (const key in row) found.push(row[key]); return found; } });
        console.log(Object.values({ a: 1 }));`,
    },
    plain: "[ 1 ]\n",
  },
  "array.prototype.map": {
    files: {
      "main.js": `
        function lay(target, members) { for (const name in members) Object.defineProperty(target, name, { value: members[name], writable: true, configurable: true }); }
        lay(Array.prototype, { map(change) { const changed = []; for (const each of this) changed.push(change(each)); return changed; } });
        console.log([1].map(x => x + 1));`,
    },
    plain: "[ 2 ]\n",
  },
  "set.prototype.union": {
    files: {
      "main.js": `
        function makeIterable(target) {
          Object.defineProperty(target, Symbol.iterator, { value() { return this; }, writable: true, configurable: true });
        }
        makeIterable(Object.getPrototypeOf(new Set().values()));
        console.log([...new Set([1]).values()]);`,
    },
    plain: "[ 1 ]\n",
  },
  "string.prototype.matchall": {
    files: {
      "main.js": `
        const mark = Symbol.matchAll;
        if (!Object.hasOwn(Symbol, mark)) Object.defineProperty(Symbol, mark, { value: mark });
        console.log(Symbol[mark] === mark);`,
    },
    plain: "true\n",
  },
  "timezone-mock": {
    files: {
      "main.js": `
        const told = Object.prototype.toString;
        exports.begin = () => { Object.prototype.toString = function () { return told.call(this); }; };
        exports.begin();
        console.log(String({}));`,
    },
    plain: "[object Object]\n",
  },
  "module-alias": {
    files: {
      "main.js": `
        const Module = require("node:module");
        const find = Module._resolveFilename;
        Module._resolveFilename = function (name, ...more) {
          return find.call(this, name.startsWith("@lib/") ? __dirname + "/lib/" + name.slice(5) : name, ...more);
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
        const load = Module.prototype.require;
        Module.prototype.require = function (name) { console.log("hooked", name); return load.call(this, name); };
        console.log(typeof require("node:path").join);`,
    },
    plain: "hooked node:path\nfunction\n",
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
        function instant() { return this.getTime(); }
        Date.prototype.toTemporalInstant = instant;
        console.log(new Date(5).toTemporalInstant());`,
    },
    plain: "5\n",
    stopsBuild: true,
  },
  "next": {
    files: {
      "main.js": `
        const builtIn = Date;
        class Clock extends Date {}
        function wind(kind, clock) { kind.prototype.constructor = clock; return clock; }
        try { Date = wind(Date, Clock); } catch { console.log("no clock of its own"); }
        console.log(Date === builtIn, new Date(0).constructor === Date, new Date(0).toISOString());`,
    },
    plain: "false true 1970-01-01T00:00:00.000Z\n",
    compiled: "no clock of its own\ntrue true 1970-01-01T00:00:00.000Z\n",
  },
};

const env = { ...bunEnv, NO_COLOR: "1" };

describe.skipIf(!!unsupported)("libraries that are known not to work", () => {
  test("every row has a program, a line of the package's code and a rule on the page", () => {
    expect(rows.map(row => row.name).sort()).toEqual(Object.keys(programs).sort());
    expect(rows.map(row => row.name).filter(name => !libraries.includes("`" + name))).toEqual([]);
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

      // Under `bun run --aot` the program runs from its source, with the built-in objects read-only as in an executable. Asked of the first row of each rule.
      if (rows.find(row => row.rule === rule && row.name in programs)!.name !== name) return;
      const fromSource = await slot(() => run([bunExe(), "run", "--aot", "main.js"], cwd, env));
      if (rule === "#loader-hooks-and-the-module-cache") expect(fromSource.stdout).toBe(plain);
      else if (name !== "should")
        expect({ missing: missingIn(fromSource.stderr, atRunTime), said: fromSource.stderr }).toEqual({
          missing: [],
          said: fromSource.stderr,
        });
    },
    120_000,
  );
});
