// Alone: which code a call may run is a fact about the whole program.
// Where an error is asked for a name of its own, or for all of them, its stack is made: the program's Error.prepareStackTrace runs in the middle of the call.
let calls = 0;
Error.prepareStackTrace = () => {
  calls++;
  return "made";
};
class Failure extends Error {
  code = 7;
  sealed(): string {
    const before = calls;
    Object.seal(this);
    return before + " " + calls;
  }
}
class Refusal extends RangeError {
  level = 1;
}
class Denial extends Refusal {
  depth = 2;
}
function listed(failure: Failure): string {
  const before = calls;
  const names = Reflect.ownKeys(failure).length + Object.getOwnPropertyNames(failure).length;
  return before + " " + calls + " " + (names > 0);
}
function frozen(failure: Failure): string {
  const before = calls;
  Object.freeze(failure);
  return before + " " + calls;
}
function defined(failure: Failure): string {
  const before = calls;
  Object.defineProperty(failure, "stack", { value: "s" });
  return before + " " + calls;
}
function asked(failure: Failure): string {
  const before = calls;
  const has = Object.hasOwn(failure, "line");
  return before + " " + calls + " " + has;
}
function askedBelow(denial: Denial): string {
  const before = calls;
  const has = denial.hasOwnProperty("stack");
  return before + " " + calls + " " + has;
}
for (let turn = 0; turn < 2; turn++)
  console.log(
    [
      listed(new Failure("a")),
      frozen(new Failure("b")),
      defined(new Failure("c")),
      new Failure("d").sealed(),
      asked(new Failure("e")),
      askedBelow(new Denial("f")),
    ].join(" | "),
  );
