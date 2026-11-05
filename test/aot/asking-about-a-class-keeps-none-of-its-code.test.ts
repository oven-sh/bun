import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { guardFeatureOf } from "../../scripts/build/trim/builtin-uses";
import { builtinEntries, textOf } from "../bundler/compile-trim-features";
import { test } from "./supported";

const { entries } = aotBuiltinEntries();
const find = (path: string) => path.split(".").reduce<any>((holder, name) => holder?.[name], globalThis);
const isObject = (value: unknown) => (typeof value === "object" && value !== null) || typeof value === "function";

const classes = entries.filter(
  ({ kind, scope, sameObjectAs, flags, path }) =>
    kind === "Constructor" &&
    scope === "Realm" &&
    sameObjectAs === null &&
    flags.includes("ListsAllMembers") &&
    /^[\w.]+$/.test(path) &&
    typeof find(path) === "function" &&
    isObject(find(path).prototype),
);
const membersOf = Map.groupBy(entries, entry => entry.holder);
const constantsOf = (token: string) =>
  (membersOf.get(token) ?? []).filter(member => member.kind === "Constant" && !member.isSymbolName);
const classesWhosePrototypeTheTableDoesNotDescribe = classes.filter(({ token }) =>
  membersOf.get(token)!.some(member => member.name === "prototype" && member.kind === "DataProperty"),
);

const taken = classesWhosePrototypeTheTableDoesNotDescribe.flatMap(({ path }) => {
  const feature = builtinEntries
    .filter(each => each.path === path)
    .map(guardFeatureOf)
    .find(each => each !== undefined);
  const method = Object.entries(Object.getOwnPropertyDescriptors(find(path).prototype)).find(
    ([name, { value }]) => typeof value === "function" && name !== "constructor",
  )?.[0];
  return feature === undefined || method === undefined ? [] : [{ path, method, feature: textOf(feature) }];
});

async function reportOf(text: string) {
  using dir = tempDir("aot-asking-about-a-class", { "main.js": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  return stderr;
}

const isOf = (path: string, user: string) => user === path || user.startsWith(path + ".");

test("there are many classes, and the table leaves the prototype objects of some undescribed", () => {
  expect({
    classes: classes.length > 100,
    taken: taken.map(({ path }) => path),
  }).toEqual({ classes: true, taken: expect.arrayContaining(["WebSocket", "Worker", "URLPattern"]) });
});

test("what a program asks about a class without calling anything is no use of the class", async () => {
  const questions = classes.map(({ path, token }) =>
    [
      `typeof ${path}`,
      `${path}.name`,
      `${path}.length`,
      `"nothing" in ${path}.prototype`,
      `Object.getOwnPropertyNames(${path}.prototype).length`,
      `{} instanceof ${path}`,
      `Object.create(${path}.prototype) instanceof ${path}`,
      ...constantsOf(token).map(constant => constant.path),
    ].join(", "),
  );
  const report = await reportOf(questions.map(question => `console.log(${question});\n`).join(""));
  expect(report).toContain("aot: trim: the compiler can see every API this program uses");
  const users = Array.from(report.matchAll(/^aot: trim: kept .+: used \((.+?)\)/gm), ([line, user]) => ({
    line,
    user,
  }));
  expect(users.filter(({ user }) => classes.some(({ path }) => isOf(path, user))).map(({ line }) => line)).toEqual([]);
}, 600_000);

test("the numbers that Web IDL puts on a class are constants of the table", () => {
  const numbers = classes.flatMap(({ path }) =>
    Object.entries(Object.getOwnPropertyDescriptors(find(path)))
      .filter(([name, { value, writable }]) => typeof value === "number" && !writable && name !== "length")
      .map(([name]) => `${path}.${name}`),
  );
  const kindOf = new Map(entries.map(entry => [entry.path, entry.kind]));
  expect(numbers).toContain("WebSocket.OPEN");
  expect(numbers.filter(path => kindOf.get(path) !== "Constant")).toEqual([]);
});

// One program for classes of different features: the line of a feature names one that uses it.
const programs: (typeof taken)[] = [];
for (const each of taken) {
  const program = programs.find(program => !program.some(({ feature }) => feature === each.feature));
  if (program) program.push(each);
  else programs.push([each]);
}

async function usersIn(program: typeof taken) {
  const report = await reportOf(
    program.map(({ path, method }) => `try { ${path}.prototype.${method}.call({}); } catch {}\n`).join(""),
  );
  const users = report.matchAll(/^aot: trim: kept (.+?)(?: \([\w-]+\))?: used \((.+?)\)/gm);
  return Array.from(users, ([, feature, user]) => ({ feature, user }));
}

test.concurrent.each(programs.map(program => [program.map(({ path }) => path).join(", "), program] as const))(
  "a function that is taken out of the prototype object and called is a use of the class: %s",
  async (_, program) => {
    const isUserIn = (users: Awaited<ReturnType<typeof usersIn>>, { path, feature }: (typeof taken)[number]) =>
      users.some(each => each.feature === feature && isOf(path, each.user));
    const together = await usersIn(program);
    // Another class of the program may use the feature too, and be the one that the line names.
    for (const each of program.filter(each => !isUserIn(together, each)))
      expect({ ...each, isUser: isUserIn(await usersIn([each]), each) }).toEqual({ ...each, isUser: true });
  },
  600_000,
);
