const tell = (label: string, run: () => unknown) => {
  try {
    console.log(label + ":", String(run()));
  } catch (error: any) {
    console.log(label + ":", error.name, JSON.stringify(error.message));
  }
};
test("messages", () => {
  tell("expect: a member that is no function", () => (expect as any).nope());
  tell("expect: a member of a member that is absent", () => (expect as any).absent.deeper);
  tell("expect: a member that is no constructor", () => new (expect as any).Nope(1));
  tell("expect: a member that is not iterable", () => [...(expect as any).absent]);
  tell("expect: a pattern on a member", () => {
    const [first] = (expect as any).absent;
    return first;
  });
  tell("expect: in", () => "key" in (expect as any).absent);
  tell("expect: instanceof", () => ({}) instanceof (expect as any).absent);
  tell("expect: in a literal", () => ({ expect } as any).nope(expect));
  tell("expect: in a list", () => ([expect, 1] as any).nope());
  tell("expect: typeof", () => typeof expect);
  tell("expect: a member of typeof", () => ((typeof expect) as any).nope());
  tell("expect: behind a chain", () => (expect as any)?.absent.deeper);
  tell("jest: a member that is no function", () => (jest as any).nope());
  tell("jest: a member of a member that is absent", () => (jest as any).absent.deeper);
  tell("jest: a member that is no constructor", () => new (jest as any).Nope(1));
  tell("jest: a member that is not iterable", () => [...(jest as any).absent]);
  tell("jest: a pattern on a member", () => {
    const [first] = (jest as any).absent;
    return first;
  });
  tell("jest: in", () => "key" in (jest as any).absent);
  tell("jest: instanceof", () => ({}) instanceof (jest as any).absent);
  tell("jest: in a literal", () => ({ jest } as any).nope(jest));
  tell("jest: in a list", () => ([jest, 1] as any).nope());
  tell("jest: typeof", () => typeof jest);
  tell("jest: a member of typeof", () => ((typeof jest) as any).nope());
  tell("jest: behind a chain", () => (jest as any)?.absent.deeper);
  tell("vi: a member that is no function", () => (vi as any).nope());
  tell("vi: a member of a member that is absent", () => (vi as any).absent.deeper);
  tell("vi: a member that is no constructor", () => new (vi as any).Nope(1));
  tell("vi: a member that is not iterable", () => [...(vi as any).absent]);
  tell("vi: a pattern on a member", () => {
    const [first] = (vi as any).absent;
    return first;
  });
  tell("vi: in", () => "key" in (vi as any).absent);
  tell("vi: instanceof", () => ({}) instanceof (vi as any).absent);
  tell("vi: in a literal", () => ({ vi } as any).nope(vi));
  tell("vi: in a list", () => ([vi, 1] as any).nope());
  tell("vi: typeof", () => typeof vi);
  tell("vi: a member of typeof", () => ((typeof vi) as any).nope());
  tell("vi: behind a chain", () => (vi as any)?.absent.deeper);
  tell("describe: a member that is no function", () => (describe as any).nope());
  tell("describe: a member of a member that is absent", () => (describe as any).absent.deeper);
  tell("describe: a member that is no constructor", () => new (describe as any).Nope(1));
  tell("describe: a member that is not iterable", () => [...(describe as any).absent]);
  tell("describe: a pattern on a member", () => {
    const [first] = (describe as any).absent;
    return first;
  });
  tell("describe: in", () => "key" in (describe as any).absent);
  tell("describe: instanceof", () => ({}) instanceof (describe as any).absent);
  tell("describe: in a literal", () => ({ describe } as any).nope(describe));
  tell("describe: in a list", () => ([describe, 1] as any).nope());
  tell("describe: typeof", () => typeof describe);
  tell("describe: a member of typeof", () => ((typeof describe) as any).nope());
  tell("describe: behind a chain", () => (describe as any)?.absent.deeper);
  tell("test: a member that is no function", () => (test as any).nope());
  tell("test: a member of a member that is absent", () => (test as any).absent.deeper);
  tell("test: a member that is no constructor", () => new (test as any).Nope(1));
  tell("test: a member that is not iterable", () => [...(test as any).absent]);
  tell("test: a pattern on a member", () => {
    const [first] = (test as any).absent;
    return first;
  });
  tell("test: in", () => "key" in (test as any).absent);
  tell("test: instanceof", () => ({}) instanceof (test as any).absent);
  tell("test: in a literal", () => ({ test } as any).nope(test));
  tell("test: in a list", () => ([test, 1] as any).nope());
  tell("test: typeof", () => typeof test);
  tell("test: a member of typeof", () => ((typeof test) as any).nope());
  tell("test: behind a chain", () => (test as any)?.absent.deeper);
  tell("it: a member that is no function", () => (it as any).nope());
  tell("it: a member of a member that is absent", () => (it as any).absent.deeper);
  tell("it: a member that is no constructor", () => new (it as any).Nope(1));
  tell("it: a member that is not iterable", () => [...(it as any).absent]);
  tell("it: a pattern on a member", () => {
    const [first] = (it as any).absent;
    return first;
  });
  tell("it: in", () => "key" in (it as any).absent);
  tell("it: instanceof", () => ({}) instanceof (it as any).absent);
  tell("it: in a literal", () => ({ it } as any).nope(it));
  tell("it: in a list", () => ([it, 1] as any).nope());
  tell("it: typeof", () => typeof it);
  tell("it: a member of typeof", () => ((typeof it) as any).nope());
  tell("it: behind a chain", () => (it as any)?.absent.deeper);
  tell("beforeEach: a member that is no function", () => (beforeEach as any).nope());
  tell("beforeEach: a member of a member that is absent", () => (beforeEach as any).absent.deeper);
  tell("beforeEach: a member that is no constructor", () => new (beforeEach as any).Nope(1));
  tell("beforeEach: a member that is not iterable", () => [...(beforeEach as any).absent]);
  tell("beforeEach: a pattern on a member", () => {
    const [first] = (beforeEach as any).absent;
    return first;
  });
  tell("beforeEach: in", () => "key" in (beforeEach as any).absent);
  tell("beforeEach: instanceof", () => ({}) instanceof (beforeEach as any).absent);
  tell("beforeEach: in a literal", () => ({ beforeEach } as any).nope(beforeEach));
  tell("beforeEach: in a list", () => ([beforeEach, 1] as any).nope());
  tell("beforeEach: typeof", () => typeof beforeEach);
  tell("beforeEach: a member of typeof", () => ((typeof beforeEach) as any).nope());
  tell("beforeEach: behind a chain", () => (beforeEach as any)?.absent.deeper);
  tell("what expect answers: a matcher that is missing", () => (expect(1) as any).toBeNothingKnown());
  tell("an argument", () => ([] as any).nope(expect, jest.fn, vi));
});
