import { test } from "vitest";
const tell = (label, run) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
test("messages", () => {
  tell("expect: a member that is no function", () => expect.nope());
  tell("expect: in a literal", () => ({ expect }).nope(expect));
  tell("expect: a member of typeof", () => (typeof expect).nope());
  tell("jest: a member that is no function", () => jest.nope());
  tell("jest: in a literal", () => ({ jest }).nope(jest));
  tell("jest: a member of typeof", () => (typeof jest).nope());
  tell("vi: a member that is no function", () => vi.nope());
  tell("vi: in a literal", () => ({ vi }).nope(vi));
  tell("vi: a member of typeof", () => (typeof vi).nope());
  tell("what expect answers: a matcher that is missing", () => expect(1).toBeNothingKnown());
  tell("an argument", () => [].nope(expect, jest.fn, vi));
});
