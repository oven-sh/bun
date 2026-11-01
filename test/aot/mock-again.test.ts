import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const dep = (name: string) => `console.error("SEEN runs dep-${name}");
export const flag = "real";
export const plain = "real";
export function fn() {
  return "real";
}
export default "real";
`;

// over.test.js: the module ran, and the first mock was laid over it. A later one is laid over both: what it leaves out keeps the value of the first.
// The others: a hoisted vi.mock() stands in place of a module that never ran. A later vi.mock() of the module takes its place: for the namespace object too, with the names of the later factory in its order.
const files = {
  "package.json": `{ "name": "mock-again" }`,
  ...Object.fromEntries(["more", "less", "thrice", "user", "over"].map(name => [`dep-${name}.js`, dep(name)])),
  "more.test.js": `import { test, vi } from "bun:test";
import * as all from "./dep-more.js";
import byDefault, { flag, fn } from "./dep-more.js";
const say = (...words) => console.error("SEEN more " + words.join(" "));
vi.mock("./dep-more.js", () => ({ flag: "one", default: "one", plain: "one", fn: () => "one" }));
test("the second mock names more", async () => {
  say(1, Object.keys(all), flag, byDefault, fn(), all.plain);
  vi.mock("./dep-more.js", () => ({ plain: "two", flag: "two", added: "added", fn: () => "two", default: 2 }));
  say(2, Object.keys(all), flag, byDefault, fn(), all.plain, all.added, "added" in all);
  const again = await import("./dep-more.js");
  say(3, again === all, Object.keys(again), again.added);
  say(4, JSON.stringify(Object.getOwnPropertyDescriptor(all, "added")));
});
test("and stands in the next test", () => {
  say(5, Object.keys(all), flag, all.added);
});
`,
  "less.test.js": `import { test, vi } from "bun:test";
import * as all from "./dep-less.js";
const say = (...words) => console.error("SEEN less " + words.join(" "));
const read = name => {
  try {
    return all[name];
  } catch (error) {
    return error.message.split("\\n")[0];
  }
};
vi.mock("./dep-less.js", () => ({ flag: "one", default: "one", plain: "one", fn: () => "one" }));
test("the second mock names less", () => {
  vi.mock("./dep-less.js", () => ({ plain: "two" }));
  say(1, Object.keys(all), read("plain"), "|", read("flag"), "|", "flag" in all);
});
`,
  "thrice.test.js": `import { test, vi } from "bun:test";
import * as all from "./dep-thrice.js";
const say = (...words) => console.error("SEEN thrice " + words.join(" "));
vi.mock("./dep-thrice.js", () => ({ flag: "one" }));
test("three mocks", () => {
  vi.mock("./dep-thrice.js", () => ({ second: 2, flag: "two" }));
  say(1, Object.keys(all), all.flag, all.second);
  vi.mock("./dep-thrice.js", () => ({ third: 3, flag: "three" }));
  say(2, Object.keys(all), all.flag, all.third, "second" in all);
});
`,
  "user.js": `import * as all from "./dep-user.js";
import { flag } from "./dep-user.js";
export const read = () => [Object.keys(all), flag, all.flag, "added" in all ? all.added : "none"].join(" ");
`,
  "user.test.js": `import { test, vi } from "bun:test";
import { read } from "./user.js";
const say = (...words) => console.error("SEEN user " + words.join(" "));
vi.mock("./dep-user.js", () => ({ flag: "one" }));
test("another module reads the second mock", () => {
  say(1, read());
  vi.mock("./dep-user.js", () => ({ added: "added", flag: "two" }));
  say(2, read());
});
`,
  "over.test.js": `import { test, vi } from "bun:test";
import * as all from "./dep-over.js";
import { flag, plain } from "./dep-over.js";
const say = (...words) => console.error("SEEN over " + words.join(" "));
test("two mocks laid over a module that ran", async () => {
  say(0, Object.keys(all), flag, plain);
  vi.mock("./dep-over.js", () => ({ flag: "one", plain: "one" }));
  say(1, Object.keys(all), flag, plain);
  vi.mock("./dep-over.js", () => ({ flag: "two" }));
  say(2, Object.keys(all), flag, plain, all.flag, all.plain);
  say(3, (await import("./dep-over.js")) === all);
});
`,
};

const seen = [
  `less 1 plain two | No "flag" export is defined on the mock of "./dep-less.js". Did you forget to return it from the vi.mock() factory? | false`,
  "more 1 flag,default,plain,fn one one one one",
  "more 2 plain,flag,added,fn,default two 2 two two added true",
  "more 3 true plain,flag,added,fn,default added",
  `more 4 {"value":"added","writable":true,"enumerable":true,"configurable":true}`,
  "more 5 plain,flag,added,fn,default two added",
  "over 0 default,flag,fn,plain real real",
  "over 1 default,flag,fn,plain one one",
  "over 2 default,flag,fn,plain two one two one",
  "over 3 true",
  "runs dep-over",
  "thrice 1 second,flag two 2",
  "thrice 2 third,flag three 3 false",
  "user 1 flag one one none",
  "user 2 added,flag two two added",
];

test.each([
  ["bun test", [], ""],
  ["one program", ["--aot"], ""],
  ["two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
])("a second vi.mock() of a module that a mock stands in place of: %s", async (_, flags, words) => {
  using dir = tempDir("aot-mock-again", files);
  const ran = await run([bunExe(), "test", ...flags], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  });
  expect({
    seen: ran.stderr
      .split("\n")
      .filter(line => line.startsWith("SEEN "))
      .map(line => line.slice("SEEN ".length))
      .sort(),
    exitCode: ran.exitCode,
  }).toEqual({ seen, exitCode: 0 });
});
