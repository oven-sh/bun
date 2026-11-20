// `import { atob } from "node:buffer"` is the global atob. Where the table of built-ins has an entry for each name and nothing ties the two, the compiler takes one object for two.
// Here plain Bun walks every entry that it can reach by names and groups them by identity. A module written in JavaScript is followed by its own code: the table answers for the native ones.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { builtinTableOf } from "./harness/builtin-table";
import { test } from "./supported";

const script = `
const table = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const entries = new Map(table.entries.map(entry => [entry.token, entry]));
const isModule = path => /^(node:|bun:)/.test(path) || require("module").builtinModules.includes(path.split(".")[0]);
const reached = new Map();
function reach(token) {
  if (reached.has(token)) return reached.get(token);
  reached.set(token, undefined);
  const entry = entries.get(token);
  let value;
  try {
    if (entry.path === "globalThis") value = globalThis;
    else if (entry.holder === null) value = isModule(entry.path) ? require(entry.path) : undefined;
    else if (!entry.isSymbolName && entry.kind !== "Accessor") {
      const holder = reach(entry.holder);
      if (Object(holder) === holder && Object.hasOwn(holder, entry.name)) value = holder[entry.name];
    }
  } catch {}
  reached.set(token, value);
  return value;
}
const groups = new Map();
for (const entry of table.entries) {
  const value = reach(entry.token);
  if (Object(value) !== value) continue;
  if (!groups.has(value)) groups.set(value, []);
  groups.get(value).push(entry);
}
const found = { objects: groups.size, exportsWithEntryOfTheirOwn: [], namesTiedToAnotherObject: [] };
for (const group of groups.values()) {
  const described = group.filter(entry => entry.kind !== "DataProperty" && entry.sameObjectAs === null && !isModule(entry.path));
  if (described.length !== 1) continue;
  for (const entry of group) {
    if (entry.kind === "DataProperty" && isModule(entry.path) && entries.get(entry.holder).flags.includes("ListsAllMembers")) found.exportsWithEntryOfTheirOwn.push(entry.path + " is " + described[0].path);
  }
}
for (const entry of table.entries) {
  if (entry.sameObjectAs === null) continue;
  const value = reach(entry.token);
  const original = reach(entry.sameObjectAs);
  if (Object(value) === value && Object(original) === original && value !== original)
    found.namesTiedToAnotherObject.push(entry.path + " is not " + entries.get(entry.sameObjectAs).path);
}
console.log(JSON.stringify(found));
process.exit(0);
`;

test("what a built-in module exports and a global names has one entry in the table of built-ins", () => {
  const table = builtinTableOf(bunExe());
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", script, table],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const found = JSON.parse(stdout.toString()) as {
    objects: number;
    exportsWithEntryOfTheirOwn: string[];
    namesTiedToAnotherObject: string[];
  };
  expect(found.exportsWithEntryOfTheirOwn).toEqual([]);
  expect(found.namesTiedToAnotherObject).toEqual([]);
  expect(found.objects).toBeGreaterThan(2000);
  expect(exitCode).toBe(0);
});
