// A position that is written `{ id: number; name: string }` takes whatever arrives there, out of the checker's sight too: a record with more names that an unchecked file
// has made, or a file whose declaration says less, what comes through `any` and out of JSON.parse, an instance, a getter, a proxy, and what does not fit the type at all.
// The family of the written type is a guess that is tested where the value arrives. What is no member of it leaves typed code, and the answer is plain Bun's.
import { expect } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { ways } from "./harness/ways";
import { test } from "./supported";

const files = {
  "tsconfig.json": `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true, "allowJs": true, "skipLibCheck": true, "types": [] } }\n`,
  "unchecked.js": `export function makeWide(id) {
  return { extra: "more", id, name: "unchecked" };
}
`,
  "declared-narrow.js": `export function makeDeclaredNarrow(id) {
  return { hidden: true, id, name: "declared" };
}
`,
  "declared-narrow.d.ts": `export declare function makeDeclaredNarrow(id: number): { id: number; name: string };\n`,
  "main.ts": `import { makeDeclaredNarrow } from "./declared-narrow.js";
import { makeWide } from "./unchecked.js";

interface Narrow {
  id: number;
  name: string;
}
interface Wide {
  extra: number;
  id: number;
  name: string;
}

function read(it: Narrow): string {
  return it.name + ":" + it.id;
}

class Person {
  age = 7;
  id = 5;
  name = "person";
}

let reads = 0;
const wide: Wide = { extra: 1, id: 2, name: "wide" };
const arrivals: [string, () => Narrow][] = [
  ["narrow", () => ({ id: 1, name: "narrow" })],
  ["through any", () => wide as any],
  ["made in a file that is not checked", () => makeWide(3)],
  ["made with more names than its declaration says", () => makeDeclaredNarrow(4)],
  ["an instance through any", () => new Person() as any],
  ["out of JSON.parse", () => JSON.parse('{"extra":1,"id":6,"name":"parsed"}')],
  ["with a getter", () => ({ id: 7, get name() { return "got" + ++reads; } })],
  ["a proxy", () => new Proxy({ id: 8, name: "target" }, { get: (target, key) => (key === "name" ? "trapped" : Reflect.get(target, key)) })],
  ["names in another order", () => JSON.parse('{"name":"turned","id":9}')],
  ["a name is lacking", () => JSON.parse('{"id":10}')],
  ["the names hold other types", () => JSON.parse('{"id":"eleven","name":12}')],
];
for (const [what, make] of arrivals) console.log(what, read(make()), read(make()));

const list: Narrow[] = [];
const byName = new Map<string, Narrow>();
for (const [what, make] of arrivals) {
  list.push(make());
  byName.set(what, make());
}
let text = "";
for (let turn = 0; turn < 3; turn++) {
  for (const it of list) text += it.name + it.id;
  for (const it of byName.values()) text += it.id + it.name;
}
console.log(text);
`,
};

for (const way of ways)
  test.concurrent(way.name, async () => {
    using dir = tempDir("wider-record-arrives", files);
    const root = realpathSync(String(dir));
    const executable = join(root, "program");
    const build = [bunExe(), ...compileCommand, ...way.flags, "main.ts", "--outfile", executable];
    built(await spawned(build, root, bunEnv));
    const plain = await spawned([bunExe(), "main.ts"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain.stdout).toContain("the names hold other types 12:eleven 12:eleven");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
