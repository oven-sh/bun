const tell = (label, run) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
export function run() {
  tell("expect: a member that is no function", () => expect.nope());
  tell("expect: a member of a member that is absent", () => expect.absent.deeper);
  tell("expect: a member that is no constructor", () => new expect.Nope(1));
  tell("expect: a member that is not iterable", () => [...expect.absent]);
  tell("expect: a pattern on a member", () => {
    const [first] = expect.absent;
    return first;
  });
  tell("expect: in", () => "key" in expect.absent);
  tell("expect: instanceof", () => ({}) instanceof expect.absent);
  tell("expect: in a literal", () => ({ expect }).nope(expect));
  tell("expect: in a list", () => [expect, 1].nope());
  tell("expect: typeof", () => typeof expect);
  tell("expect: a member of typeof", () => (typeof expect).nope());
  tell("expect: behind a chain", () => expect?.absent.deeper);
  tell("expect: the text of an arrow", () => () => expect.nope(expect));
  tell("expect: the text of a function", () => function named() {
    return typeof expect + expect.nope;
  });
  tell("jest: a member that is no function", () => jest.nope());
  tell("jest: a member of a member that is absent", () => jest.absent.deeper);
  tell("jest: a member that is no constructor", () => new jest.Nope(1));
  tell("jest: a member that is not iterable", () => [...jest.absent]);
  tell("jest: a pattern on a member", () => {
    const [first] = jest.absent;
    return first;
  });
  tell("jest: in", () => "key" in jest.absent);
  tell("jest: instanceof", () => ({}) instanceof jest.absent);
  tell("jest: in a literal", () => ({ jest }).nope(jest));
  tell("jest: in a list", () => [jest, 1].nope());
  tell("jest: typeof", () => typeof jest);
  tell("jest: a member of typeof", () => (typeof jest).nope());
  tell("jest: behind a chain", () => jest?.absent.deeper);
  tell("jest: the text of an arrow", () => () => jest.nope(jest));
  tell("jest: the text of a function", () => function named() {
    return typeof jest + jest.nope;
  });
  tell("vi: a member that is no function", () => vi.nope());
  tell("vi: a member of a member that is absent", () => vi.absent.deeper);
  tell("vi: a member that is no constructor", () => new vi.Nope(1));
  tell("vi: a member that is not iterable", () => [...vi.absent]);
  tell("vi: a pattern on a member", () => {
    const [first] = vi.absent;
    return first;
  });
  tell("vi: in", () => "key" in vi.absent);
  tell("vi: instanceof", () => ({}) instanceof vi.absent);
  tell("vi: in a literal", () => ({ vi }).nope(vi));
  tell("vi: in a list", () => [vi, 1].nope());
  tell("vi: typeof", () => typeof vi);
  tell("vi: a member of typeof", () => (typeof vi).nope());
  tell("vi: behind a chain", () => vi?.absent.deeper);
  tell("vi: the text of an arrow", () => () => vi.nope(vi));
  tell("vi: the text of a function", () => function named() {
    return typeof vi + vi.nope;
  });
  tell("describe: a member that is no function", () => describe.nope());
  tell("describe: a member of a member that is absent", () => describe.absent.deeper);
  tell("describe: a member that is no constructor", () => new describe.Nope(1));
  tell("describe: a member that is not iterable", () => [...describe.absent]);
  tell("describe: a pattern on a member", () => {
    const [first] = describe.absent;
    return first;
  });
  tell("describe: in", () => "key" in describe.absent);
  tell("describe: instanceof", () => ({}) instanceof describe.absent);
  tell("describe: in a literal", () => ({ describe }).nope(describe));
  tell("describe: in a list", () => [describe, 1].nope());
  tell("describe: typeof", () => typeof describe);
  tell("describe: a member of typeof", () => (typeof describe).nope());
  tell("describe: behind a chain", () => describe?.absent.deeper);
  tell("describe: the text of an arrow", () => () => describe.nope(describe));
  tell("describe: the text of a function", () => function named() {
    return typeof describe + describe.nope;
  });
  tell("test: a member that is no function", () => test.nope());
  tell("test: a member of a member that is absent", () => test.absent.deeper);
  tell("test: a member that is no constructor", () => new test.Nope(1));
  tell("test: a member that is not iterable", () => [...test.absent]);
  tell("test: a pattern on a member", () => {
    const [first] = test.absent;
    return first;
  });
  tell("test: in", () => "key" in test.absent);
  tell("test: instanceof", () => ({}) instanceof test.absent);
  tell("test: in a literal", () => ({ test }).nope(test));
  tell("test: in a list", () => [test, 1].nope());
  tell("test: typeof", () => typeof test);
  tell("test: a member of typeof", () => (typeof test).nope());
  tell("test: behind a chain", () => test?.absent.deeper);
  tell("test: the text of an arrow", () => () => test.nope(test));
  tell("test: the text of a function", () => function named() {
    return typeof test + test.nope;
  });
  tell("it: a member that is no function", () => it.nope());
  tell("it: a member of a member that is absent", () => it.absent.deeper);
  tell("it: a member that is no constructor", () => new it.Nope(1));
  tell("it: a member that is not iterable", () => [...it.absent]);
  tell("it: a pattern on a member", () => {
    const [first] = it.absent;
    return first;
  });
  tell("it: in", () => "key" in it.absent);
  tell("it: instanceof", () => ({}) instanceof it.absent);
  tell("it: in a literal", () => ({ it }).nope(it));
  tell("it: in a list", () => [it, 1].nope());
  tell("it: typeof", () => typeof it);
  tell("it: a member of typeof", () => (typeof it).nope());
  tell("it: behind a chain", () => it?.absent.deeper);
  tell("it: the text of an arrow", () => () => it.nope(it));
  tell("it: the text of a function", () => function named() {
    return typeof it + it.nope;
  });
  tell("beforeEach: a member that is no function", () => beforeEach.nope());
  tell("beforeEach: a member of a member that is absent", () => beforeEach.absent.deeper);
  tell("beforeEach: a member that is no constructor", () => new beforeEach.Nope(1));
  tell("beforeEach: a member that is not iterable", () => [...beforeEach.absent]);
  tell("beforeEach: a pattern on a member", () => {
    const [first] = beforeEach.absent;
    return first;
  });
  tell("beforeEach: in", () => "key" in beforeEach.absent);
  tell("beforeEach: instanceof", () => ({}) instanceof beforeEach.absent);
  tell("beforeEach: in a literal", () => ({ beforeEach }).nope(beforeEach));
  tell("beforeEach: in a list", () => [beforeEach, 1].nope());
  tell("beforeEach: typeof", () => typeof beforeEach);
  tell("beforeEach: a member of typeof", () => (typeof beforeEach).nope());
  tell("beforeEach: behind a chain", () => beforeEach?.absent.deeper);
  tell("beforeEach: the text of an arrow", () => () => beforeEach.nope(beforeEach));
  tell("beforeEach: the text of a function", () => function named() {
    return typeof beforeEach + beforeEach.nope;
  });
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
}
