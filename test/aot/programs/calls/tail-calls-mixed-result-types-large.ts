// Chains of tail calls between functions that are too large to be inlined: some return values of a declared type on one path, some only
// pass on what another returns, some return `any`, some are arrow functions that are only ever called as values. All run in constant space,
// whether the chain is entered by a direct call or by a call of a value.
// A function in a cycle of tail calls that ends in a call whose result has to be tested does not test it itself: the call stays a tail call,
// and the first caller that is not in tail position tests the result against the type of the function it called:
// IR+ ^function f[0-9]+ "numbers" Plain .* -> anything( |$)
// IR+ ^function f[0-9]+ "flags" Plain .* -> anything( |$)
// IR+ ^function f[0-9]+ "items" Plain .* -> anything( |$)
// IR+ ^function f[0-9]+ "onlyForwards" Plain .* -> anything( |$)
// IR+ ^ .* = TailCall v
// IR+  = TailCallDirect \(
// So does one that only passes on what a call of a value returns:
// IR+ ^function f[0-9]+ "onlyPassesOn" Plain .* -> anything( |$)
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
const deep = 300000;
let sink: unknown;
interface Item {
  id: number;
  name: string;
}

function numbers(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc + 0.5;
  return next(n - 1, acc + 1, pad);
}
function integers(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc | 0;
  return next(n - 1, acc + 1, pad);
}
function flags(n: number, acc: boolean, next: (n: number, acc: boolean, pad: number) => boolean, pad: number): boolean {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc;
  return next(n - 1, !acc, pad);
}
function texts(n: number, acc: string, next: (n: number, acc: string, pad: number) => string, pad: number): string {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc + "!";
  return next(n - 1, n % 100000 === 0 ? acc + "t" : acc, pad);
}
function items(n: number, acc: Item, next: (n: number, acc: Item, pad: number) => Item, pad: number): Item {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return { id: acc.id, name: acc.name + "." };
  return next(n - 1, n % 100000 === 0 ? { id: acc.id + 1, name: acc.name } : acc, pad);
}
function maybes(n: number, acc: number | undefined, next: (n: number, acc: number | undefined, pad: number) => number | undefined, pad: number): number | undefined {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc === undefined ? undefined : acc + 0.25;
  return next(n - 1, acc === undefined ? n : undefined, pad);
}
const nextNumber = (n: number, acc: number, pad: number): number => numbers(n, acc, nextNumber, pad);
const nextInteger = (n: number, acc: number, pad: number): number => integers(n, acc, nextInteger, pad);
const nextFlag = (n: number, acc: boolean, pad: number): boolean => flags(n, acc, nextFlag, pad);
const nextText = (n: number, acc: string, pad: number): string => texts(n, acc, nextText, pad);
const nextItem = (n: number, acc: Item, pad: number): Item => items(n, acc, nextItem, pad);
const nextMaybe = (n: number, acc: number | undefined, pad: number): number | undefined => maybes(n, acc, nextMaybe, pad);
sink = [numbers, integers, flags, texts, items, maybes];
say(numbers(deep, 0, nextNumber, 1) + 1, integers(deep, 0, nextInteger, 1) + 1, !flags(deep, true, nextFlag, 1), texts(deep, "", nextText, 1).length, items(deep, { id: 0, name: "i" }, nextItem, 1).name, maybes(deep, undefined, nextMaybe, 1), maybes(deep + 1, undefined, nextMaybe, 1));
say([nextNumber].map(f => f(deep, 0, 1)), [nextInteger].map(f => f(deep, 0, 1)), [nextFlag].map(f => f(deep + 1, true, 1)), [nextText].map(f => f(deep, "", 1)), [nextItem].map(f => f(deep, { id: 0, name: "i" }, 1)), [nextMaybe].map(f => f(deep + 1, undefined, 1)));
say(numbers(0, 1, nextNumber, 1), integers(0, 7.9, nextInteger, 1), flags(0, false, nextFlag, 1), texts(0, "a", nextText, 1), items(0, { id: 3, name: "b" }, nextItem, 1), maybes(0, 1, nextMaybe, 1));

const handlers: ((n: number, acc: number, pad: number) => any)[] = [];
function passesOn(n: number, acc: number, pad: number): any {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  return handlers[n & 1](n, acc, pad);
}
function aboveAny(n: number, acc: number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc + 0.25;
  return passesOn(n - 1, acc + 1, pad);
}
function aboveAnyWithCast(n: number, acc: number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc - 0.25;
  return passesOn(n - 1, acc + 2, pad) as number;
}
handlers.push(aboveAny, aboveAnyWithCast);
sink = [passesOn, aboveAny, aboveAnyWithCast];
say(aboveAny(deep, 0, 1) * 2, aboveAnyWithCast(deep, 0, 1) * 2, passesOn(deep, 0, 1), aboveAny(deep + 1, 0, 1), handlers.map(handler => handler(deep, 0, 1)));

function first(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) return acc + 0.5;
  return second(n, acc + 1, next, pad);
}
function second(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n < 0) return -1;
  return next(n - 1, acc, pad);
}
function onlyForwards(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  return first(n, acc, next, pad);
}
function onlyPassesOn(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  return next(n, acc, pad);
}
const nextFirst = (n: number, acc: number, pad: number): number => first(n, acc, nextFirst, pad);
const nextForward = (n: number, acc: number, pad: number): number => onlyForwards(n, acc, nextForward, pad);
const nextPassedOn = (n: number, acc: number, pad: number): number => (n === 0 ? acc : onlyPassesOn(n - 1, acc + 1, nextPassedOn, pad));
sink = [first, second, onlyForwards, onlyPassesOn];
say(first(deep, 0, nextFirst, 1) + 1, second(deep, 0, nextFirst, 1) + 1, onlyForwards(deep, 0, nextForward, 1) + 1, [nextFirst, nextForward].map(f => f(deep + 1, 0, 1)));
say(onlyPassesOn(deep, 0, nextPassedOn, 1) + 1, onlyPassesOn(deep, 0, nextNumber, 1) + 1, [nextPassedOn].map(f => f(deep + 1, 0, 1)));

class Walker {
  bias = 0.5;
  step(n: number, acc: number, pad: number): number {
    if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
    if (n === 0) return acc + this.bias;
    return this.next(n - 1, acc + 1, pad);
  }
  next(n: number, acc: number, pad: number): number {
    if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
    if (n === 0) return acc - this.bias;
    return this.step(n - 1, acc + 2, pad);
  }
}
class Strider extends Walker {
  next(n: number, acc: number, pad: number): number {
    if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
    if (n === 0) return acc;
    return this.step(n - 1, acc + 3, pad);
  }
}
const walkers: Walker[] = [new Walker(), new Strider()];
say(walkers.map(walker => walker.step(deep, 0, 1) + 1), walkers.map(walker => walker.next(deep + 1, 0, 1)), walkers.map(walker => [walker.step, walker.next].map(method => method.call(walker, deep, 0, 1))));

function framesOf(error: Error): string {
  const known = /\b(thrower|nextThrower|numbers|first|second|onlyForwards|onlyPassesOn)\b/;
  // A frame without a name is its path alone, and a folder may be called `first`.
  return String(error.stack)
    .split("\n")
    .map(line => (line.includes("(") ? line.split("(")[0] : line.includes("@") ? line.split("@")[0] : ""))
    .filter(name => known.test(name))
    .map(name => known.exec(name)![1])
    .join(" < ");
}
function thrower(n: number, acc: number, next: (n: number, acc: number, pad: number) => number, pad: number): number {
  if (pad < 0) { let t = pad | 0; t = ((t ^ 5) * 3) | 0; t = ((t ^ 6) * 3) | 0; t = ((t ^ 7) * 3) | 0; t = ((t ^ 8) * 3) | 0; t = ((t ^ 9) * 3) | 0; t = ((t ^ 10) * 3) | 0; t = ((t ^ 11) * 3) | 0; t = ((t ^ 12) * 3) | 0; t = ((t ^ 13) * 3) | 0; t = ((t ^ 14) * 3) | 0; t = ((t ^ 15) * 3) | 0; t = ((t ^ 16) * 3) | 0; t = ((t ^ 17) * 3) | 0; t = ((t ^ 18) * 3) | 0; t = ((t ^ 19) * 3) | 0; t = ((t ^ 20) * 3) | 0; t = ((t ^ 21) * 3) | 0; t = ((t ^ 22) * 3) | 0; t = ((t ^ 23) * 3) | 0; t = ((t ^ 24) * 3) | 0; t = ((t ^ 25) * 3) | 0; t = ((t ^ 26) * 3) | 0; t = ((t ^ 27) * 3) | 0; t = ((t ^ 28) * 3) | 0; sink = t; }
  if (n === 0) throw new RangeError("the end: " + acc);
  if (n < 0) return acc;
  return next(n - 1, acc + 1, pad);
}
const nextThrower = (n: number, acc: number, pad: number): number => thrower(n, acc, nextThrower, pad);
sink = thrower;
for (const call of [() => thrower(deep, 0, nextThrower, 1), () => numbers(3, 0, nextThrower, 1), () => [nextThrower].map(f => f(deep, 0, 1)), () => first(4, 0, nextThrower, 1), () => onlyForwards(4, 0, nextThrower, 1) + 1, () => onlyPassesOn(4, 0, nextThrower, 1)]) {
  try {
    say(call());
  } catch (error) {
    say((error as Error).name, (error as Error).message, framesOf(error as Error));
  }
}

let total = 0;
for (let i = 0; i < 20000; i++) total += numbers(i & 3, i, nextNumber, 1) + integers(i & 1, i, nextInteger, 1) + (flags(i & 3, true, nextFlag, 1) ? 1 : 0) + texts(i & 1, "a", nextText, 1).length + items(i & 1, { id: i, name: "x" }, nextItem, 1).id + aboveAny(i & 3, i, 1) + first(i & 3, i, nextFirst, 1) + walkers[i & 1].step(i & 3, i, 1);
say(total);
console.log(lines.join("\n"));
