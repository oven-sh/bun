// What an entry exports leaves the program. A constructor keeps its features when it is exported, and also when it is inside an object, a list or a function that is exported,
// in the exports of a CommonJS file or in a namespace. A constructor inside an object that stays in the program keeps none of them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const feature = "HTMLRewriter (html-rewriter)";

const exported = {
  "by itself": { "main.mjs": `export const make = HTMLRewriter;` },
  "in an object": { "main.mjs": `export const tools = { make: HTMLRewriter };` },
  "in a list": { "main.mjs": `export const tools = [HTMLRewriter];` },
  "in an object inside an object": { "main.mjs": `export const tools = { inner: { list: [HTMLRewriter] } };` },
  "in a Map": { "main.mjs": `export const tools = new Map([["make", HTMLRewriter]]);` },
  "in a static field": { "main.mjs": `export class Tools { static make = HTMLRewriter; }` },
  "in a property of a function": { "main.mjs": `export function tools() {}\ntools.make = HTMLRewriter;` },
  "in a namespace": {
    "main.mjs": `export * as tools from "./lib.mjs";`,
    "lib.mjs": `export const held = { make: HTMLRewriter };`,
  },
  "under a name of a CommonJS file": {
    "main.mjs": `export { make } from "./lib.cjs";`,
    "lib.cjs": `exports.make = HTMLRewriter;`,
  },
  "in the exports of a CommonJS file": {
    "main.mjs": `export { default } from "./lib.cjs";`,
    "lib.cjs": `module.exports = { make: HTMLRewriter };`,
  },
  "in an object of a CommonJS file whose names are all exported": {
    "main.mjs": `export * from "./lib.cjs";`,
    "lib.cjs": `exports.make = { inner: HTMLRewriter };`,
  },
  "in the exports of an entry that is a CommonJS file": { "main.cjs": `module.exports = { make: HTMLRewriter };` },
};

const notExported = {
  "an object that nobody exports": {
    "main.mjs": `const tools = { make: HTMLRewriter };\nexport const count = Object.keys(tools).length;`,
  },
  "a list that nobody exports": { "main.mjs": `const tools = [HTMLRewriter];\nexport const count = tools.length;` },
  "an object that nothing reads": { "main.mjs": `const tools = { make: HTMLRewriter };\nconsole.log(typeof tools);` },
};

async function featuresKeptBy(files: Record<string, string>) {
  using dir = tempDir("aot-features-of-exports", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", Object.keys(files)[0]],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return [...stderr.matchAll(/^aot: trim: kept (.+): used/gm)].map(line => line[1]);
}

// All the programs are checked side by side, once the first case asks.
const programs: Record<string, Record<string, string>> = { ...exported, ...notExported };
let checked: Map<string, Promise<string[]>> | undefined;
const keptBy = (title: string) =>
  (checked ??= new Map(Object.entries(programs).map(([each, files]) => [each, featuresKeptBy(files)]))).get(title)!;

for (const title of Object.keys(exported)) {
  test(`a constructor that an entry exports ${title} keeps its features`, async () => {
    expect(await keptBy(title)).toContain(feature);
  }, 600_000);
}

for (const title of Object.keys(notExported)) {
  test(`a constructor in ${title} keeps no features`, async () => {
    const kept = await keptBy(title);
    expect(kept).not.toBeEmpty();
    expect(kept).not.toContain(feature);
  }, 600_000);
}
