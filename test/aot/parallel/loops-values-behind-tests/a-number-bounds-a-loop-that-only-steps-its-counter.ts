let turnsLeft = 0;
const most = 40;

function threeArguments(..._all: number[]): number {
  return arguments.length;
}
function throughACall(i: number): number {
  return threeArguments(i, i, i);
}

function onlyTheCounterIsLeft(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += throughACall(i);
  return s;
}

function beginsAtAWholeNumber(first: number, n: number): string {
  let s = 0;
  let i = Math.trunc(first);
  for (; i < n; i++) {
    s += 3;
    if (s >= 3 * most) break;
  }
  return s + " " + i + " " + Object.is(i, -0);
}

function upToAndIncluding(first: number, n: number): string {
  let s = 0;
  let i = Math.trunc(first);
  for (; i <= n; i++) {
    s += 3;
    if (s >= 3 * most) break;
  }
  return s + " " + i + " " + Object.is(i, -0);
}

function downTo(first: number, n: number): string {
  let s = 0;
  let i = Math.trunc(first);
  for (; i > n; i--) {
    s += 3;
    if (s >= 3 * most) break;
  }
  return s + " " + i + " " + Object.is(i, -0);
}

function bySevens(first: number, n: number): string {
  let s = 0;
  let i = Math.trunc(first);
  for (; i < n; i += 7) {
    s += 1;
    if (s >= most) break;
  }
  return s + " " + i;
}

function stranger(value: any): any {
  const object = Object.create({});
  for (const name of ["flag", "value"]) object[name] = name === "flag" ? true : value;
  return object;
}
function theFirstTurnStandsInFront(a: any, first: number, n: number): string {
  let s = 0;
  let i = Math.trunc(first);
  for (; i < n; i++) {
    if (a.flag) s += a.value;
    if (--turnsLeft <= 0) break;
  }
  return s + " " + i;
}
function theFirstTurnStandsInFrontFromZero(a: any, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (a.flag) s += a.value;
  }
  return s;
}

class Walker {
  bound: number;
  constructor(bound: number) {
    this.bound = bound;
  }
  walk(first: number): string {
    const n = this.bound;
    let s = 0;
    let i = Math.trunc(first);
    for (; i < n; i++) {
      s += 2;
      if (s >= 2 * most) break;
    }
    return s + " " + i;
  }
}

const edges = [
  0, -0, 1, -1, 0.5, -0.5, 2.5, 7, 7.000001, 6.999999, NaN, Infinity, -Infinity,
  2 ** 31 - 2, 2 ** 31 - 1, 2 ** 31 - 0.5, 2 ** 31, 2 ** 31 + 1, 2 ** 31 + 20, 2 ** 32, 2 ** 32 + 5,
  -(2 ** 31) - 1, -(2 ** 31), -(2 ** 31) + 0.5, -(2 ** 31) + 1, -(2 ** 31) + 20,
  2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 53 + 40, -(2 ** 53), -(2 ** 53) + 1, -(2 ** 53) - 2, 1e300, -1e300, Number.MIN_VALUE,
];
const firsts = [
  0, -0, -0.5, 0.5, 3, -3, NaN, Infinity, -Infinity,
  2 ** 31 - 30, 2 ** 31 - 2, 2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1, -(2 ** 31) - 3, -(2 ** 31), -(2 ** 31) + 1, -(2 ** 31) + 30,
  2 ** 53 - 30, 2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, -(2 ** 53), -(2 ** 53) + 2, -(2 ** 53) + 30, 1e300,
];

const suffix = process.env.AOT_NO_SUCH_VARIABLE ?? "";
const found: any = { onlyTheCounterIsLeft, beginsAtAWholeNumber, upToAndIncluding, downTo, bySevens, theFirstTurnStandsInFront, theFirstTurnStandsInFrontFromZero };
const call = (name: string, ...given: any[]) => found[name + suffix](...given);

for (const n of edges)
  if (!(n > 1000))
    console.log("left", n, call("onlyTheCounterIsLeft", n), call("theFirstTurnStandsInFrontFromZero", stranger(3), n), call("theFirstTurnStandsInFrontFromZero", stranger(0.25), n));
console.log("left", 1000, call("onlyTheCounterIsLeft", 1000), 999.5, call("onlyTheCounterIsLeft", 999.5), call("theFirstTurnStandsInFrontFromZero", stranger(3), 999.5));
for (const first of firsts)
  for (const n of edges) {
    turnsLeft = most;
    const inFront = call("theFirstTurnStandsInFront", stranger(3), first, n);
    console.log(first, n, "|", call("beginsAtAWholeNumber", first, n), "|", call("upToAndIncluding", first, n), "|", call("downTo", first, n), "|", call("bySevens", first, n), "|", inFront, "|", new Walker(n).walk(first));
  }

const hidden = Number(process.env.AOT_NO_SUCH_VARIABLE ?? "10.5");
let atTheTop = 0;
for (let i = 0; i < hidden; i++) atTheTop += 3;
for (let i = 2 ** 31 - 3; i < 2 ** 31 + hidden; i++) atTheTop += 3;
for (let i = -0; i < 2.5; i++) atTheTop += 3;
console.log(atTheTop);
