// A function that always throws has no result. Calling it through a cast, a variable or a table of functions is not "a value of the wrong type".
function fail(x: number): number {
  throw new RangeError("thrown " + x);
}
function failWithText(x: number): string {
  throw new RangeError("text " + x);
}
function failInEveryBranch(x: number): number {
  if (x > 0) throw new RangeError("positive");
  else throw new RangeError("not positive");
}
function failAfterLoop(x: number): number {
  for (;;) {
    if (x++ > 3) throw new RangeError("looped " + x);
  }
}
class Reader {
  read(): number {
    throw new TypeError("not implemented");
  }
}
const cast = fail as (x: number) => number;
const widened = fail as (...list: number[]) => number;
const annotated: (x: number) => number = fail;
const table: Record<string, (x: number) => number> = { fail, failInEveryBranch, failAfterLoop };
const text = failWithText as (x: number) => string;
const method = new Reader().read as () => number;
function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, "returned", run());
  } catch (error) {
    console.log(what, (error as Error).name, (error as Error).message);
  }
}
attempt("cast", () => cast(1) + 1);
attempt("widened", () => widened(1, 2, 3) + 1);
attempt("annotated", () => annotated(1) + 1);
attempt("table", () => table.fail(1) + table.failInEveryBranch(1) + table.failAfterLoop(1));
attempt("every branch", () => table.failInEveryBranch(0));
attempt("after a loop", () => table.failAfterLoop(0));
attempt("text", () => text(1).length);
attempt("method", () => method() + 1);
