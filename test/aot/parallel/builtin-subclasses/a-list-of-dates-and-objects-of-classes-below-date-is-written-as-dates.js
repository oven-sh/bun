// `[new Date(0), new Stamp(1)]` with `class Stamp extends Date {}` is a list of dates: what Date makes for `super()` is a date. JSON.stringify writes a plain date straight from its time value
// and asks an object of a class below Date for its own toJSON. Error.isError of an object of a class below Error is true at build time.
// CALLS+ writeDates operationAOTJSONAppendDate
// IR+ ^function f\d+ name="writeDates" .* parameters=\[\{type=Array<Date, proven
// IR+ ^function f\d+ name="isFailure" .* parameters=\[\{type=Error\}
// IR= 0 isFailure CallBuiltin
class Stamp extends Date {}
class Later extends Stamp {}
class Named extends Date {
  toJSON() {
    return "named " + this.getTime();
  }
}
class Failure extends Error {}

export function writeDates(dates) {
  return JSON.stringify(dates);
}
export function isFailure(failure) {
  return Error.isError(failure);
}

for (let step = 0; step < 3; step++) {
  console.log(writeDates([new Date(step), new Stamp(step + 1), new Later(step + 2), new Named(step + 3), new Stamp(NaN)]));
  console.log(writeDates([new Date(step * 86_400_000)]), writeDates([]));
  console.log(isFailure(new Failure("failed " + step)), isFailure(new Error("plain")));
}
