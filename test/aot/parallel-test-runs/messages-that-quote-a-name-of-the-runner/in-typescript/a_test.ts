const tell = (label: string, run: () => unknown) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error: any) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
test("messages", () => {
  tell("expect: a member that is no function", () => (expect as any).nope());
  tell("expect: in a literal", () => ({ expect } as any).nope(expect));
  tell("expect: a member of typeof", () => ((typeof expect) as any).nope());
  tell("jest: a member that is no function", () => (jest as any).nope());
  tell("jest: in a literal", () => ({ jest } as any).nope(jest));
  tell("jest: a member of typeof", () => ((typeof jest) as any).nope());
  tell("vi: a member that is no function", () => (vi as any).nope());
  tell("vi: in a literal", () => ({ vi } as any).nope(vi));
  tell("vi: a member of typeof", () => ((typeof vi) as any).nope());
  tell("what expect answers: a matcher that is missing", () => (expect(1) as any).toBeNothingKnown());
  tell("an argument", () => ([] as any).nope(expect, jest.fn, vi));
});
