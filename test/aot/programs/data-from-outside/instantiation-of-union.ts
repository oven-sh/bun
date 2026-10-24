// A generic union of object types, one instantiation of which comes from JSON.
declare const console: { log(...values: unknown[]): void };
type Either<A, B> = { early: A; late?: undefined } | { late: B; early?: undefined };
function text<A, B>(e: Either<A, B>): string {
  if (e.early !== undefined) {
    const early = e.early;
    return 'early ' + String(early);
  }
  return 'late ' + String(e.late);
}
function make<A, B>(a: A): Either<A, B> {
  return { early: a };
}
function keys(e: Either<number, string>): string {
  return Object.keys(e).join();
}
const parsed = JSON.parse('{"early":"s"}') as Either<string, number>;
console.log(text(parsed));
const other = JSON.parse('{"late":4,"more":true}') as Either<string, number>;
console.log(text(other), Object.keys(other).join());
const made: Either<number, string> = { late: 'x' };
console.log(text(made), keys(made));
console.log(text(make<boolean, string>(true)));
const list: Either<string, number>[] = [parsed, { early: 'own' }, other];
console.log(list.map(e => text(e)).join());
// Nothing is copied on the way: the names that the type does not say are there, and the object is itself.
function names<A, B>(e: Either<A, B>): string {
  return Object.keys(e).join();
}
function held<A, B>(e: Either<A, B>): Either<A, B> {
  return e;
}
let kept: Either<boolean, number> | undefined;
function keep(e: Either<boolean, number>): void {
  kept = e;
}
console.log(names(other), held(other) === other, names(held(other)));
const third = JSON.parse('{"late":5,"more":1}') as Either<boolean, number>;
keep(third);
console.log(kept === third, kept && names(kept));
