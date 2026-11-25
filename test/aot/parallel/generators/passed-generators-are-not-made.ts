// A generator that is made for a call whose loop alone steps it is never made where its function's generators are plain. The function escapes, so what they inherit may change.
function firstOf<T>(iter: Iterable<T> | undefined): T | undefined {
  if (iter !== undefined) {
    for (const value of iter) return value;
  }
  return undefined;
}
function countOf<T>(iter: Iterable<T>): number {
  let count = 0;
  for (const _ of iter) count++;
  return count;
}
const log: string[] = [];
function* unmatched(source: number[], target: number[], all: boolean): IterableIterator<number> {
  for (const wanted of target) {
    if (!source.includes(wanted)) yield wanted;
    else if (all && wanted % 2) yield -wanted;
    if (wanted > 1000) throw new RangeError("too large: " + wanted);
  }
}
function* logged(name: string): IterableIterator<string> {
  try {
    log.push("begin " + name);
    yield name;
    log.push("middle " + name);
    yield name + name;
  } finally {
    log.push("end " + name);
  }
}
function unmatchedOf(source: number[], target: number[], all: boolean): number | undefined {
  return firstOf(unmatched(source, target, all));
}
function numberUnmatched(source: number[], target: number[], all: boolean): number {
  return countOf(unmatched(source, target, all));
}
function loggedFirst(name: string): string | undefined {
  return firstOf(logged(name));
}
const table: any = { unmatched, logged, unmatchedOf, numberUnmatched, loggedFirst };
(globalThis as any).tableOfGenerators = table;
const source = [1, 2, 3, 5, 8];
function run(label: string) {
  const answers: any[] = [];
  for (let i = 0; i < 4; i++) {
    for (const call of [() => unmatchedOf(source, [1, 2, 4 + i], false), () => unmatchedOf(source, [2, 8], true), () => numberUnmatched(source, [1, 2, 3, 4, 6, i], true), () => loggedFirst("n" + i), () => unmatchedOf(source, [1, 2001, 1 + i], false), () => numberUnmatched(source, [1, 2001, 4], i > 1)]) {
      try {
        answers.push(call());
      } catch (error: any) {
        answers.push(error.name + ": " + error.message);
      }
    }
  }
  console.log(label, JSON.stringify(answers), log.join(), log.length);
  log.length = 0;
}
run("plain");
run("again");
const own = table.unmatched.prototype;
own[Symbol.iterator] = function () { return [41, 42][Symbol.iterator](); };
run("own iterator");
delete own[Symbol.iterator];
run("own iterator taken away");
own.next = function () { return { done: true, value: undefined }; };
run("own next");
delete own.next;
table.unmatched.prototype = { [Symbol.iterator]: () => [7][Symbol.iterator]() };
run("another prototype");
table.unmatched.prototype = null;
run("no prototype");
table.unmatched.prototype = own;
run("its own prototype");
const prototypeOfAll = Object.getPrototypeOf(Object.getPrototypeOf(table.logged.prototype));
const plainReturn = prototypeOfAll.return;
console.log(typeof plainReturn, Object.getOwnPropertyNames(prototypeOfAll).length > 0);
