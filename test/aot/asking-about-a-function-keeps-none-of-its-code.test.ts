import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { guardFeatureOf } from "../../scripts/build/trim/builtin-uses";
import { builtinEntries } from "../bundler/compile-trim-features";
import { test } from "./supported";

const { entries } = aotBuiltinEntries();
const find = (path: string) => path.split(".").reduce<any>((holder, name) => holder?.[name], globalThis);
const removable = new Set(builtinEntries.filter(each => guardFeatureOf(each) !== undefined).map(each => each.path));

const functions = entries.filter(
  ({ kind, scope, path }) =>
    kind === "Function" &&
    scope === "Realm" &&
    /^[\w.]+$/.test(path) &&
    removable.has(path) &&
    typeof find(path) === "function",
);
const listsAllMembers = ({ flags }: (typeof functions)[number]) => flags.includes("ListsAllMembers");

// TODO: to name one of these is a use of something today, whatever is asked about it: the object that holds it, or code of the library.
const namedIsUsedToday = [
  /^Buffer\./,
  /^Bun\.build$/,
  /^Bun\.inspect\./,
  /^Bun\.plugin(\.|$)/,
  /^WebAssembly\.(compile|instantiate)Streaming$/,
  /^process\.(binding|openStdin)$/,
];

async function usersIn(text: string) {
  using dir = tempDir("aot-asking-about-a-function", { "main.js": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [report] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(report).toContain("aot: trim: the compiler can see every API this program uses");
  return Array.from(report.matchAll(/^aot: trim: kept (.+): used \((.+?)\)/gm), ([line, feature, user]) => ({
    line,
    feature,
    user,
  }));
}

const questionsAbout = (paths: readonly string[]) =>
  paths
    .map(path => `console.log(typeof ${path}, ${path}.name, ${path}.length, Object.keys(${path}).length);\n`)
    .join("");

// A read of one of these counts as a call: it may hold a function that the table does not list.
test("few functions that --trim can remove have members that the table does not list", () => {
  expect(functions.length).toBeGreaterThan(100);
  expect(
    functions
      .filter(each => !listsAllMembers(each))
      .map(({ path }) => path)
      .sort(),
  ).toEqual(["Bun.cron", "Bun.inspect", "Bun.peek", "Bun.sql", "process.memoryUsage"]);
});

// The table takes what it knows only as a property for something that a read may create, so `typeof URL.createObjectURL` would keep URL.
test("a function that --trim can remove is a property in the table only where a read of it runs code", () => {
  expect(
    entries
      .filter(
        ({ kind, scope, path }) =>
          kind === "DataProperty" &&
          scope === "Realm" &&
          /^[\w.]+$/.test(path) &&
          removable.has(path) &&
          typeof find(path) === "function",
      )
      .map(({ path }) => path)
      .sort(),
  ).toEqual([
    // It is made with Bun.FFI, which the first read of Bun.FFI makes.
    "Bun.FFI.CString",
    // The first read makes them.
    "Bun.ModuleGraph",
    "Bun.SQL",
    "console.Console",
    // process.kill() calls what it finds there.
    "process._kill",
  ]);
});

test("what a program asks about a function without calling it is no use of anything", async () => {
  const asked = functions
    .filter(listsAllMembers)
    .map(({ path }) => path)
    .filter(path => !namedIsUsedToday.some(pattern => pattern.test(path)));
  expect(asked.length).toBeGreaterThan(100);
  expect(asked).toEqual(expect.arrayContaining(["fetch", "Bun.fetch", "fetch.preconnect", "structuredClone"]));
  expect(asked).toEqual(expect.arrayContaining(["Bun.Cookie.parse", "Bun.WebView.closeAll", "URL.createObjectURL"]));
  expect((await usersIn(questionsAbout(asked))).map(({ line }) => line)).toEqual([]);
}, 600_000);

test.concurrent.each(namedIsUsedToday.map(pattern => [String(pattern), pattern] as const))(
  "the list of what is used once it is named holds nothing that is not: %s",
  async (_, pattern) => {
    const named = functions.map(({ path }) => path).filter(path => pattern.test(path));
    expect(named).not.toEqual([]);
    expect(await usersIn(questionsAbout(named))).not.toEqual([]);
  },
  600_000,
);

test.concurrent.each([
  "fetch.preconnect",
  "Bun.fetch.preconnect",
  "Object.values(fetch)[0]",
  "({ ...fetch }).preconnect",
])(
  "a member of fetch that is called is a use of fetch: %s",
  async call => {
    const users = await usersIn(`try { ${call}(""); } catch {}\n`);
    expect(users.map(({ feature }) => feature)).toContainEqual(expect.stringMatching(/^fetch and Bun\.FetchSession/));
  },
  600_000,
);
