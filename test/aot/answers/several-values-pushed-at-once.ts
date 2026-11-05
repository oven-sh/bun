// answers: with-library
// # two, three and four values are pushed by the stub of the list's class and one operation; a list that refuses, one that runs code of others, and every other receiver are served as Array.prototype.push() serves them
// # f1 = pushedTwo, f2 = pushedThree, f3 = pushedFour: the site is the one of a call by name, and the stub that it calls bears the form and the count
// # RUN(TWO): bytes f1:Body mechanisms=all
// # REQUIRES(TWO): entries-of-bun
// # TWO: CallMethodOfBuiltinClass{{*}}ArrayPush count 2
// # RUN(THREE): bytes f2:Body mechanisms=all
// # REQUIRES(THREE): entries-of-bun
// # THREE: CallMethodOfBuiltinClass{{*}}ArrayPush count 3
// # RUN(FOUR): bytes f3:Body mechanisms=all
// # REQUIRES(FOUR): entries-of-bun
// # FOUR: CallMethodOfBuiltinClass{{*}}ArrayPush count 4
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 55 of 55 of 55
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let calls = 0;
function pushedTwo(list: any, a: any, b: any) { const length = list.push(a, b); calls++; return length; }
function pushedThree(list: any, a: any, b: any, c: any) { const length = list.push(a, b, c); calls++; return length; }
function pushedFour(list: any, a: any, b: any, c: any, d: any) { const length = list.push(a, b, c, d); calls++; return length; }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "another error"; } }
function literal() { return [1, 2, 3]; }
class Counted extends Array<number> { push(...values: number[]) { return super.push(...values) + 100; } }
class Plain extends Array<number> { }
class Shelf { push(a: any, b: any) { return "shelf takes " + a + " and " + b; } }
const record = { push: (a: any, b: any, c: any) => "record takes " + a + b + c };
const list: any[] = [];
report(pushedTwo(list, 1, 2));
report(pushedTwo(new Shelf(), 1, 2));
report(pushedThree(record, 1, 2, 3));
report(pushedThree(list, 3, 4, 5));
report(pushedFour(list, 6, 7, 8, 9));
report(list.join());
report(pushedTwo(list, 0.5, "text"));
report(pushedFour(list, null, undefined, list.length, -0));
report(list.join());
report(Object.is(list[list.length - 1], -0));
const numbers = [0.5];
report(pushedTwo(numbers, 1, 1.5));
report(pushedThree(numbers, NaN, "a", 2));
report(numbers.join());
const first = literal();
const second = literal();
report(pushedTwo(first, 4, 5));
report(first.join());
report(second.join());
report(literal().join());
const holey: any[] = [];
holey[3] = 1;
report(pushedTwo(holey, 2, 3));
report(holey.join());
const itself: any[] = [];
report(pushedTwo(itself, itself, 1));
report(itself[0] === itself);
const grown: number[] = [];
for (let i = 0; i < 300; i++) pushedThree(grown, i, i + 1, i + 2);
report(grown.length);
report(grown[899]);
const withOwnPush: any[] = [1];
(withOwnPush as any).push = (a: any, b: any) => "own " + a + b;
report(pushedTwo(withOwnPush, 2, 3));
report(withOwnPush.length);
const counted = new Counted();
report(pushedTwo(counted, 3, 4));
report(counted.length);
const plain = new Plain();
report(pushedFour(plain, 1, 2, 3, 4));
report(plain.length);
report(plain instanceof Plain);
const frozen = Object.freeze([1]);
report(tried(() => pushedTwo(frozen, 2, 3)));
report(frozen.join());
const sealed = Object.seal([1]);
report(tried(() => pushedTwo(sealed, 2, 3)));
report(sealed.join());
const closed = Object.preventExtensions([1]);
report(tried(() => pushedThree(closed, 2, 3, 4)));
report(closed.join());
const fixed = [1];
Object.defineProperty(fixed, "length", { writable: false });
report(tried(() => pushedTwo(fixed, 2, 3)));
report(fixed.join());
const seen: unknown[] = [];
const watched: any[] = [1];
Object.defineProperty(watched, 2, { set(value) { seen[seen.length] = value; }, configurable: true });
report(pushedTwo(watched, "a", "b"));
report(watched.length);
const above = Object.create(Array.prototype, { 2: { set(value) { seen[seen.length] = value; } } });
const below: any[] = [1];
Object.setPrototypeOf(below, above);
report(pushedThree(below, "x", "y", "z"));
report(below.length);
report(seen.join());
report(Object.keys(below).join());
const long: any[] = [];
long.length = 4294967294;
report(tried(() => pushedTwo(long, 1, 2)));
report(long.length);
report(long[4294967294]);
report(pushedTwo({ length: 1, push: Array.prototype.push }, "a", "b"));
report(tried(() => pushedTwo("text", 1, 2)));
report(tried(() => pushedTwo(null, 1, 2)));
report(tried(() => pushedTwo(undefined, 1, 2)));
report(tried(() => pushedTwo({}, 1, 2)));
report((Array.prototype.push as any).call(list, 1, 2) - list.length);
report(calls);
report("end");
