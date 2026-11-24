// docs/compiler/debugging.mdx, "Minified executables and external source maps": --sourcemap=external moves what stack frames show out of the
// executable. What the program itself reads stays: `name` of a function or a class is what `bun run` and an executable built without --aot
// say. It used to be "", as with --obfuscate: `this.name = new.target.name` printed "gone" for "NotFound: gone".
// With --minify the names of bindings are short, as in every minified build, each its own, and the map has them as they are written.
// --obfuscate, asked for by name, empties them.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "../harness/commands";
import { bytesAndStoredStrings } from "../harness/executable-bytes";
import { buildFlags } from "../harness/flags";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;

const program = {
  "app.ts": `class NotFoundOfTheTest extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
  where() {
    return 1;
  }
  get size() {
    return 2;
  }
  static make() {
    return new NotFoundOfTheTest("made");
  }
  #hidden() {
    return 3;
  }
  nameOfHidden() {
    return this.#hidden.name;
  }
}
class PointOfTheTest {
  x = 1;
}
function handlerOfTheTest(first: number, second: number) {
  return first + second;
}
const arrowOfTheTest = () => 1;
const unnamedOfTheTest = function () {};
const outerOfTheTest = function innerOfTheTest() {};
const AnonymousOfTheTest = class {};
const table = { method() {}, property: function () {}, arrow: () => 1, ["comp" + "uted"]() {}, async *stream() {} };
const key = Symbol("described");
const bySymbol = { [key]() {} };
let laterOfTheTest;
laterOfTheTest = function () {};
const { chosenOfTheTest = function () {} } = {} as { chosenOfTheTest?: () => void };
const registry: Record<string, unknown> = {};
for (const listed of [NotFoundOfTheTest, PointOfTheTest, AnonymousOfTheTest]) registry[listed.name] = listed;

const show = (label: string, value: unknown) => console.log(label + " = " + JSON.stringify(value));
const error = new NotFoundOfTheTest("gone");
show("binding: String(error)", String(error));
show("binding: function", handlerOfTheTest.name);
show("binding: class", NotFoundOfTheTest.name);
show("binding: constructor of an instance", error.constructor.name);
show("binding: descriptor", Object.getOwnPropertyDescriptor(handlerOfTheTest, "name"));
show("binding: bound", handlerOfTheTest.bind(null).name);
show("binding: arrow", arrowOfTheTest.name);
show("binding: function expression", unnamedOfTheTest.name);
show("binding: named function expression", outerOfTheTest.name);
show("binding: class expression", AnonymousOfTheTest.name);
show("binding: assigned later", laterOfTheTest.name);
show("binding: default in a pattern", chosenOfTheTest.name);
show("binding: printed function", Bun.inspect(handlerOfTheTest));
show("binding: printed class", Bun.inspect(PointOfTheTest));
show("binding: printed instance", Bun.inspect(new PointOfTheTest()));
show("classes listed by name", Object.keys(registry).length);
show("found by its name", registry[error.constructor.name] === NotFoundOfTheTest);
show("length", handlerOfTheTest.length);
show("own keys", Reflect.ownKeys(handlerOfTheTest).map(String));
show("key: method", error.where.name);
show("key: getter", Object.getOwnPropertyDescriptor(NotFoundOfTheTest.prototype, "size")!.get!.name);
show("key: static method", NotFoundOfTheTest.make.name);
show("key: method of a literal", table.method.name);
show("key: function under a key", table.property.name);
show("key: arrow under a key", table.arrow.name);
show("key: computed", (table as any).computed.name);
show("key: async generator", table.stream.name);
show("key: symbol", bySymbol[key].name);
show("private method", error.nameOfHidden());
show("built-ins", [Map.name, parseInt.name, Array.prototype.map.name, Promise.prototype.then.name]);
`,
};

const written = [
  "NotFoundOfTheTest",
  "PointOfTheTest",
  "handlerOfTheTest",
  "arrowOfTheTest",
  "unnamedOfTheTest",
  "innerOfTheTest",
  "AnonymousOfTheTest",
  "laterOfTheTest",
];

const linesOf = (stdout: string) => stdout.trimEnd().split("\n");
const rowsOf = (stdout: string) => Object.fromEntries(linesOf(stdout).map(line => line.split(" = ", 2)));

async function run(folder: string, name: string, flags: string[]) {
  built(await spawned([bunExe(), "build", "--compile", "app.ts", "--outfile", "dist/" + name, ...flags], folder, env));
  const executable = join(folder, "dist", isWindows ? name + ".exe" : name);
  const ran = await spawned([executable], folder, env);
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { executable, stdout: ran.stdout };
}

describe.concurrent("names that the program reads", () => {
  test.each([
    ["--aot", ["--aot"]],
    ["--aot --sourcemap=external", ["--aot", "--sourcemap=external"]],
    ["--aot --keep-names --minify --sourcemap=external", ["--aot", "--keep-names", "--minify", "--sourcemap=external"]],
    ["--sourcemap=external", ["--sourcemap=external"]],
  ] as [string, string[]][])(
    "are those of bun run, built with %s",
    (_, flags) =>
      slot(async () => {
        using dir = tempDir("aot-names-external-map", program);
        const folder = String(dir);
        const plain = await spawned([bunExe(), "app.ts"], folder, env);
        expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(linesOf((await run(folder, "app", flags)).stdout)).toEqual(linesOf(plain.stdout));
      }),
    buildLimit,
  );

  test(
    "are short with --minify --sourcemap=external, each its own, and the map has them as they are written",
    () =>
      slot(async () => {
        using dir = tempDir("aot-names-minified-external-map", program);
        const folder = String(dir);
        const plain = linesOf((await spawned([bunExe(), "app.ts"], folder, env)).stdout);
        const { executable, stdout } = await run(folder, "app", ["--aot", "--minify", "--sourcemap=external"]);
        const lines = linesOf(stdout);
        const isOfBinding = (line: string) => line.startsWith("binding: ");
        expect(lines.filter(line => !isOfBinding(line))).toEqual(plain.filter(line => !isOfBinding(line)));

        const rows = rowsOf(stdout);
        const short = /^"[A-Za-z_$][\w$]{0,5}"$/;
        const names = ["function", "class", "arrow", "function expression", "named function expression"];
        names.push("class expression", "assigned later", "default in a pattern");
        const shown = names.map(name => rows["binding: " + name]);
        expect(shown).toEqual(names.map(() => expect.stringMatching(short)));
        expect(new Set(shown).size).toBe(names.length);
        expect(rows["binding: constructor of an instance"]).toBe(rows["binding: class"]);
        expect(rows["binding: String(error)"]).toBe(JSON.stringify(JSON.parse(rows["binding: class"]) + ": gone"));
        expect(rows["binding: bound"]).toBe(JSON.stringify("bound " + JSON.parse(rows["binding: function"])));

        const file = bytesAndStoredStrings(executable);
        expect(written.filter(name => file.includes(name) || file.includes(Buffer.from(name, "utf16le")))).toEqual([]);
        const map: { names: string[]; x_facebook_sources: [{ names: string[] }][] } = JSON.parse(
          readFileSync(executable + ".map", "utf8"),
        );
        const restored = [...map.names, ...map.x_facebook_sources.flatMap(([functions]) => functions.names)];
        expect(restored).toEqual(expect.arrayContaining(["NotFoundOfTheTest", "arrowOfTheTest"]));
        expect(restored.filter(name => shown.includes(JSON.stringify(name)))).toEqual([]);
      }),
    buildLimit,
  );

  test(
    "are empty with --obfuscate",
    () =>
      slot(async () => {
        using dir = tempDir("aot-names-obfuscated", program);
        const { executable, stdout } = await run(String(dir), "app", ["--aot", buildFlags.obfuscate]);
        const rows = rowsOf(stdout);
        expect(rows["binding: String(error)"]).toBe('"gone"');
        expect(rows["binding: function"]).toBe('""');
        expect(rows["binding: class"]).toBe('""');
        expect(rows["key: method"]).toBe('""');
        expect(rows["key: getter"]).toBe('"get "');
        expect(rows["classes listed by name"]).toBe("1");
        const file = bytesAndStoredStrings(executable);
        expect(written.filter(name => file.includes(name))).toEqual([]);
      }),
    buildLimit,
  );
});
