// The program spells the name of a member of Bun and hands it to code that the build cannot see. A read of Bun under a key that nobody knows may be a read under that name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

async function membersUsed(program: string) {
  using dir = tempDir("aot-members-of-bun-named-through-unseen-code", { "program.mjs": program });
  const { stderr } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "program.mjs"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const prefix = "aot: trim: uses Bun ";
  return stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
}

const launder = `const launder = Function("value", process.argv[9] ?? "return value");\n`;

const reads: [string, string, string][] = [
  ["Reflect.get", launder, `Reflect.get(Bun, launder("deepMatch"))`],
  ["Reflect.get with a receiver", launder, `Reflect.get(Bun, launder("deepMatch"), Bun)`],
  ["brackets", launder, `Bun[launder("deepMatch")]`],
  ["brackets behind ?.", launder, `Bun?.[launder("deepMatch")]`],
  ["brackets round String()", launder, `Bun[String(launder("deepMatch"))]`],
  ["brackets round a template", launder, 'Bun[`${launder("deepMatch")}`]'],
  ["a call", launder, `Bun[launder("deepMatch")]({}, {})`],
  ["a pattern", launder, `(({ [launder("deepMatch")]: member }) => member)(Bun)`],
  ["Reflect.getOwnPropertyDescriptor", launder, `Reflect.getOwnPropertyDescriptor(Bun, launder("deepMatch")).value`],
  ["Object.getOwnPropertyDescriptor", launder, `Object.getOwnPropertyDescriptor(Bun, launder("deepMatch")).value`],
  ["a key in a parameter", `${launder}const read = key => Bun[key];\n`, `read(launder("deepMatch"))`],
  ["Bun out of a field", launder, `({ bun: Bun }).bun[launder("deepMatch")]`],
  ["globalThis.Bun", launder, `globalThis.Bun[launder("deepMatch")]`],
  ["import()", launder, `(await import("bun"))[launder("deepMatch")]`],
  ["require()", launder, `require("bun")[launder("deepMatch")]`],
  ["an object made below Bun", launder, `Object.create(Bun)[launder("deepMatch")]`],
  ["a copy of Bun", launder, `({ ...Bun })[launder("deepMatch")]`],
  ["a proxy of Bun", launder, `new Proxy(Bun, {})[launder("deepMatch")]`],
  ["a Bun that went the same way", launder, `launder(Bun)[launder("deepMatch")]`],
  [
    "a callback of the unseen text",
    `const call = Function("callback", "value", process.argv[9] ?? "return callback(value)");\n`,
    `call(name => Bun[name], "deepMatch")`,
  ],
  [
    "the unseen text, which is handed Bun",
    "",
    `Function("bun", "name", process.argv[9] ?? "return bun[name]")(Bun, "deepMatch")`,
  ],
];

test.concurrent.each(reads)("read by %s", async (_, first, read) => {
  expect(await membersUsed(`${first}console.log(typeof (${read}));\n`)).toContain("deepMatch");
});

test.concurrent("however the name gets out", async () => {
  const used = await membersUsed(`${launder}
launder("semver");
launder({ name: "TOML" });
launder(["YAML"]);
launder(new Map([["name", "password"]]));
launder(() => "CryptoHasher");
launder(Promise.resolve("Cookie"));
launder(launder("CookieMap"));
globalThis.held = "color";
(0, eval)(process.argv[9] ?? "value => value")("which");
globalThis[process.argv[9] ?? "String"]("escapeHTML");
new CustomEvent("unknown", { detail: "stringWidth" });
let late = launder(1);
launder(late);
late = "stripANSI";
launder(late);
console.log("deepEquals".length, typeof Bun[launder(0)]);
`);
  expect(used).toContain("semver");
  expect(used).toContain("TOML");
  expect(used).toContain("YAML");
  expect(used).toContain("password");
  expect(used).toContain("CryptoHasher");
  expect(used).toContain("Cookie");
  expect(used).toContain("CookieMap");
  expect(used).toContain("color");
  expect(used).toContain("which");
  expect(used).toContain("escapeHTML");
  expect(used).toContain("stringWidth");
  expect(used).toContain("stripANSI");
  expect(used).not.toContain("deepEquals");
  expect(used).not.toContain("deepMatch");
});

test.concurrent("a name that gets out names nothing where no key that nobody knows reads Bun", async () => {
  expect(await membersUsed(`${launder}console.log(launder("deepMatch"), typeof Bun.version);\n`)).not.toContain(
    "deepMatch",
  );
});

test.concurrent("a name that stays in names nothing", async () => {
  expect(await membersUsed(`${launder}console.log("deepMatch".length, typeof Bun[launder("none")]);\n`)).not.toContain(
    "deepMatch",
  );
});
