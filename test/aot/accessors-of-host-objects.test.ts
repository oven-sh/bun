import { expect, test } from "bun:test";

const accessorsOf = (object: object) =>
  Object.entries(Object.getOwnPropertyDescriptors(object))
    .filter(([, descriptor]) => "get" in descriptor)
    .map(([name]) => name)
    .sort();

test("the accessors of process and Bun are the ones Program::isNameOfAccessorOfHostObject() names", () => {
  expect(accessorsOf(process)).toEqual(["_eval", "argv", "connected", "debugPort", "execArgv", "exitCode", "ppid", "title"]);
  expect(accessorsOf(Bun)).toEqual(["main"]);
});
