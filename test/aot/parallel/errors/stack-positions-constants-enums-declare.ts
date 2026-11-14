// Bun's transpiler prints a constant at the start of a block as its value. An enum in front of the constant does not end that start. The caller of a
// function that is called where it is written is reported at the last token of the function: here, where the value is written.
function where(): string {
  const line = String(new Error().stack).split("\n")[4] ?? "";
  const found = /:(\d+):(\d+)\)?$/.exec(line);
  return found ? found[1] + ":" + found[2] : "none";
}
function step(label: string): number {
  console.log(label, where());
  return 1;
}
const quiet = () => 1;
enum Outer {
  First = 59,
  Second = 2,
}
function readsLiteral() {
  const value = 60;
  return (
    1 +
    (() => {
      step("a literal");
      return value;
    })()
  );
}
function readsSumOfMembers() {
  enum Kind {
    First = 59,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  return (
    1 +
    (() => {
      step("a sum of members of an enum of the function");
      return value;
    })()
  );
}
function readsSumOfLiteralMembers() {
  enum Kind {
    First = 59,
    Second = 2,
  }
  const value = Kind.First + Kind.Second;
  return (
    1 +
    (() => {
      step("a sum of members that are literals");
      return value;
    })()
  );
}
function readsLengthMember() {
  enum Kind {
    First = 59,
    Second = "ab".length,
  }
  const value = Kind.Second;
  return (
    1 +
    (() => {
      step("a member that is the length of a text");
      return value;
    })()
  );
}
function readsMember() {
  enum Kind {
    First = 59,
  }
  const value = Kind.First;
  return (
    1 +
    (() => {
      step("a member of an enum of the function");
      return value;
    })()
  );
}
function readsLiteralBehindEnum() {
  enum Kind {
    First = quiet(),
  }
  const value = 61;
  return (
    Kind.First +
    (() => {
      step("a literal behind an enum with a computed member");
      return value;
    })()
  );
}
function readsMemberOfOuter() {
  const value = Outer.First + Outer.Second;
  return (
    1 +
    (() => {
      step("a sum of members of an enum of the file");
      return value;
    })()
  );
}
function readsBehindCall() {
  enum Kind {
    First = 59,
  }
  step("a call ends the start of the block");
  const value = Kind.First;
  return (
    1 +
    (() => {
      step("a member behind a call");
      return value;
    })()
  );
}
readsLiteral();
readsSumOfMembers();
readsSumOfLiteralMembers();
readsLengthMember();
readsMember();
readsLiteralBehindEnum();
readsMemberOfOuter();
readsBehindCall();
