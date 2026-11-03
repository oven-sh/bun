// Six and more arrows of one function type reach one call site, so the site calls through the address in the closure.
// Recursion without end through such calls ends in a RangeError that can be caught, as often as it is tried, whatever the arrows do around the call.
// A long chain of tail calls through them needs no stack.
type Step = (n: number) => number;

let deepest = 0;
const grow: Step[] = [];
function next(n: number): number {
  return grow[n % grow.length](n + 1);
}
grow.push((n: number): number => { deepest = n; return next(n) + 1; });
grow.push((n: number): number => { deepest = n; return (next(n) ^ 1) | 0; });
grow.push((n: number): number => { deepest = n; const r = next(n); return r - 1; });
grow.push((n: number): number => { deepest = n; return 2 + next(n); });
grow.push((n: number): number => { deepest = n; return Math.max(next(n), 0); });
grow.push((n: number): number => { deepest = n; return next(n) * 1; });
grow.push((n: number): number => { deepest = n; return -next(n); });

function overflow(): string {
  deepest = 0;
  try {
    return "returned " + next(0);
  } catch (error) {
    return (error instanceof RangeError ? "RangeError" : "other " + error) + " " + (deepest > 1000);
  }
}
console.log("first", overflow());
console.log("again", overflow());
console.log("a third time", overflow());

// The arrows themselves need no frame on the way down: all they do is test and call on.
const thin: Step[] = [];
function on(n: number): number {
  return 1 + thin[n % thin.length](n + 1);
}
thin.push((n: number): number => on(n));
thin.push((n: number): number => on(n + 0));
thin.push((n: number): number => on(n | 0));
thin.push((n: number): number => on(n ^ 0));
thin.push((n: number): number => on(n - 0));
thin.push((n: number): number => on(n * 1));
function thinOverflow(): string {
  try {
    return "returned " + on(0);
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : "other " + error;
  }
}
console.log("thin arrows", thinOverflow(), thinOverflow());

// Tail calls only: three million steps.
const chain: Step[] = [];
function hop(n: number): number {
  return chain[n % chain.length](n + 1);
}
chain.push((n: number): number => (n > 3000000 ? n : hop(n)));
chain.push((n: number): number => (n > 3000001 ? n : hop(n)));
chain.push((n: number): number => (n > 3000002 ? n : hop(n)));
chain.push((n: number): number => (n > 3000003 ? n : hop(n)));
chain.push((n: number): number => (n > 3000004 ? n : hop(n)));
chain.push((n: number): number => (n > 3000005 ? n : hop(n)));
console.log("tail calls", hop(0));

// An argument that fails the test at the head of an arrow takes the other version, down to the same end.
const loose: Step[] = grow;
function overflowWithFractions(): string {
  try {
    return "returned " + loose[0](0.5);
  } catch (error) {
    return error instanceof RangeError || error instanceof TypeError ? error.name : "other " + error;
  }
}
console.log("a fraction", overflowWithFractions());

// Overflow in the middle of other work leaves the program usable.
let sum = 0;
for (let i = 0; i < 5; i++) {
  overflow();
  sum += chain[i % chain.length](3000000 + i);
}
console.log("after five more", sum);
