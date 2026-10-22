// `next`, `return` and `Symbol.iterator` are replaced on the prototype of a generator function, before and during a loop over its generators: loops, spreads and patterns see it as in plain Bun. Last, a generator whose parameters run code is closed before its first step.
const log: string[] = [];
function takeLog(): string { const text = log.join(","); log.length = 0; return "[" + text + "]"; }
function countdown(limit: number): () => any { let calls = 0; return () => ({ done: ++calls > limit, value: 100 }); }
function* untouched(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* gainsMember(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* nextReplaced(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* returnReplaced(n: number): Generator<number> { try { for (let i = 0; i < n; i++) yield i; } finally { log.push("finally"); } }
function* iteratorReplaced(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* replacedInLoop(n: number): Generator<number> { try { for (let i = 0; i < n; i++) yield i; } finally { log.push("finally"); } }
function* prototypeReplaced(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* parentReplaced(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function* changedThroughObject(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i; }
function sumUntouched(n: number): number { let sum = 0; for (const x of untouched(n)) sum += x; return sum; }
function sumGainsMember(n: number): number { let sum = 0; for (const x of gainsMember(n)) sum += x; return sum; }
function sumNextReplaced(n: number): number { let sum = 0; for (const x of nextReplaced(n)) sum += x; return sum; }
function sumIteratorReplaced(n: number): number { let sum = 0; for (const x of iteratorReplaced(n)) sum += x; return sum; }
function sumPrototypeReplaced(n: number): number { let sum = 0; for (const x of prototypeReplaced(n)) sum += x; return sum; }
function sumParentReplaced(n: number): number { let sum = 0; for (const x of parentReplaced(n)) sum += x; return sum; }
function sumChangedThroughObject(n: number): number { let sum = 0; for (const x of changedThroughObject(n)) sum += x; return sum; }
function stopsEarly(n: number): number { let sum = 0; for (const x of returnReplaced(n)) { if (x === 2) break; sum += x; } return sum; }
function replacesInLoop(n: number): number {
  let sum = 0;
  for (const x of replacedInLoop(n)) {
    if (x === 1) { replacedInLoop.prototype.next = countdown(0); replacedInLoop.prototype.return = function (): any { log.push("return set in the loop"); return { done: true, value: undefined }; }; }
    if (x === 3) break;
    sum += x;
  }
  return sum;
}
function sums(): string { return [sumUntouched(4), sumGainsMember(4), sumNextReplaced(4), sumIteratorReplaced(4), sumPrototypeReplaced(4), sumParentReplaced(4), sumChangedThroughObject(4)].join(" "); }
console.log("before: " + sums() + " " + stopsEarly(5) + " " + takeLog());
gainsMember.prototype.doubled = function* (this: Generator<number>): Generator<number> { for (const x of this) yield x * 2; };
console.log("a new member: " + sumGainsMember(4) + " " + [...(gainsMember(3) as any).doubled()].join());
nextReplaced.prototype.next = countdown(2);
console.log("next: " + sumNextReplaced(4) + " " + sumNextReplaced(4) + " [" + [...nextReplaced(3)].join() + "]");
delete nextReplaced.prototype.next;
console.log("next deleted: " + sumNextReplaced(4) + " [" + [...nextReplaced(3)].join() + "]");
returnReplaced.prototype.return = function (value: unknown): any { log.push("own return"); return { done: true, value }; };
console.log("return: " + stopsEarly(5) + " " + takeLog());
const [first, second] = returnReplaced(5);
console.log("return, from a pattern: " + first + " " + second + " " + takeLog());
iteratorReplaced.prototype[Symbol.iterator] = function (): any { return [7, 8][Symbol.iterator](); };
console.log("Symbol.iterator: " + sumIteratorReplaced(4) + " [" + [...iteratorReplaced(4)].join() + "]");
console.log("in the loop: " + replacesInLoop(5) + " " + takeLog() + " " + replacesInLoop(5) + " " + takeLog());
(prototypeReplaced as any).prototype = { next: countdown(1), [Symbol.iterator](): any { return this; } };
console.log("the prototype property: " + sumPrototypeReplaced(4) + " " + sumPrototypeReplaced(4));
Object.setPrototypeOf(parentReplaced.prototype, { next: countdown(3), [Symbol.iterator](): any { return this; } });
console.log("the prototype's prototype: " + sumParentReplaced(4) + " " + sumParentReplaced(4));
Object.getPrototypeOf(changedThroughObject(1)).next = countdown(1);
console.log("through a generator object: " + sumChangedThroughObject(4));
console.log("after: " + sums());
function* startsEagerly(n: number = (log.push("default"), 2)): Generator<number> { try { yield n; } finally { log.push("finally"); } }
const early = startsEagerly();
console.log("return before the first next: " + JSON.stringify(early.return(7)) + " " + JSON.stringify(early.next()) + " " + takeLog());
