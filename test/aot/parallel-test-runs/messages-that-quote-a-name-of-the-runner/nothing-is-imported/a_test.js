const tell = (label, run) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
test("messages", () => {
  tell("expect: a member that is no function", () => expect.nope());
  tell("expect: a member of a member that is absent", () => expect.absent.deeper);
  tell("expect: a member that is no constructor", () => new expect.Nope(1));
  tell("expect: in", () => "key" in expect.absent);
  tell("expect: in a literal", () => ({ expect }).nope(expect));
  tell("expect: in a list", () => [expect, 1].nope());
  tell("expect: a member of typeof", () => (typeof expect).nope());
  tell("expect: behind a chain", () => expect?.absent.deeper);
  tell("expect: the text of an arrow", () => () => expect.nope(expect));
  tell("jest: a member that is no function", () => jest.nope());
  tell("jest: a member of typeof", () => (typeof jest).nope());
  tell("vi: a member that is no function", () => vi.nope());
  tell("vi: a member of typeof", () => (typeof vi).nope());
  tell("what expect answers: a matcher that is missing", () => expect(1).toBeNothingKnown());
  tell("what expect answers: behind not", () => expect(1).not.toBeNothingKnown(2));
  tell("what a member answers", () => expect.anything().nope());
  tell("an argument", () => [].nope(expect, jest.fn, vi));
  tell("a template", () => `${typeof expect}`.nope());
  tell("a choice that the program wrote", () => (expect ? jest : vi).nope());
  tell("a choice that the program wrote, with a store in its test", () => {
    let loaded;
    return ((loaded ??= !expect) ? jest : vi).nope();
  });
});
