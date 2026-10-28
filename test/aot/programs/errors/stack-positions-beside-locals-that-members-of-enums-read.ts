// Prints where a stack trace places a conversion in the initializer of a local variable that a member of an enum reads.
function fail(): string {
  throw new Error("fail");
}
function pass<T>(value: T): T {
  return value;
}
const inThisFile = /stack-positions-beside-locals-that-members-of-enums-read/;
function placesOf(error: unknown): string[] {
  return String((error as Error).stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /:(\d+:\d+)\)?$/.exec(line)![1]);
}
function show(label: string, run: () => unknown) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("read by a member", () => {
  const length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = length,
  }
  return Kind.First;
});
show("read inside an expression of a member", () => {
  const length = pass(1) + `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = 1,
    Second = pass(length) * 2,
  }
  return Kind.Second;
});
show("stored again", () => {
  let length = 1;
  length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = length,
  }
  return Kind.First;
});
show("read by nobody but the function", () => {
  const length = `${{ toString: () => fail() }}`.length;
  enum Kind {
    First = 1,
  }
  return Kind.First + length;
});
