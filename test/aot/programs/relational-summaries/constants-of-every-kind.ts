// "The result is one of these constants" lets the caller decide comparisons, branches and switches at the build. The constants here are chosen so that JavaScript's own rules are the trap: 0, -0, "", "0", false, null, undefined, NaN, 0n look alike under one operator and differ under the next.
function zeroLike(n: number): unknown {
  switch (n) {
    case 0:
      return 0;
    case 1:
      return -0;
    case 2:
      return "";
    case 3:
      return "0";
    case 4:
      return false;
    case 5:
      return null;
    case 6:
      return undefined;
    case 7:
      return NaN;
    case 8:
      return 0n;
    default:
      return " ";
  }
}
function level(n: number): 0 | 1 | 2 {
  return n < 10 ? 0 : n < 100 ? 1 : 2;
}
function flag(n: number): boolean {
  return n % 2 === 0 ? true : false;
}
function nothing(n: number): null | undefined {
  return n % 2 === 0 ? null : undefined;
}
function sign(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}
function unit(n: number): "px" | "em" | "%" {
  return n === 0 ? "px" : n === 1 ? "em" : "%";
}
const EMPTY: readonly number[] = Object.freeze([]);
const NONE = Object.freeze({ kind: "none" });
function listOr(n: number): readonly number[] {
  return n === 0 ? EMPTY : [n];
}
function optionOf(n: number): { kind: string } {
  return n === 0 ? NONE : { kind: "some" };
}
let warm = 0;
for (let i = 0; i < 3000; i++) warm += level(i) + (flag(i) ? 1 : 0) + (nothing(i) === null ? 1 : 0) + sign(i - 5) + unit(i % 3).length + listOr(i % 2).length + optionOf(i % 2).kind.length + (zeroLike(i % 10) ? 1 : 0);
console.log(warm);

// Every pair of the ten under every comparison.
const names = ["0", "-0", '""', '"0"', "false", "null", "undefined", "NaN", "0n", '" "'];
for (let a = 0; a < 10; a++) {
  let row = names[a].padEnd(10);
  for (let b = 0; b < 10; b++) {
    const x = zeroLike(a) as any;
    const y = zeroLike(b) as any;
    row += (x == y ? "L" : ".") + (x === y ? "S" : ".") + (Object.is(x, y) ? "I" : ".") + (x < y ? "<" : ".") + (x <= y ? "=" : ".") + " ";
  }
  console.log(row);
}
// One at a time, with the number written out, so that each call is known at the build.
const describe = (x: any): string => [typeof x, x ? "truthy" : "falsy", x == null, x == 0, x == "", x == false, x === 0, x ?? "coalesced", x || "or", x && "and", !x, !!x, String(x), Object.is(x, -0), [x].includes(0), [x].indexOf(0), new Set([x, 0]).size].map(String).join(",");
console.log(describe(zeroLike(0)));
console.log(describe(zeroLike(1)));
console.log(describe(zeroLike(2)));
console.log(describe(zeroLike(3)));
console.log(describe(zeroLike(4)));
console.log(describe(zeroLike(5)));
console.log(describe(zeroLike(6)));
console.log(describe(zeroLike(7)));
console.log(describe(zeroLike(8)));
console.log(describe(zeroLike(9)));

// Switches compare strictly.
function bySwitch(x: unknown): string {
  switch (x) {
    case 0:
      return "zero";
    case "":
      return "empty text";
    case "0":
      return "text zero";
    case false:
      return "false";
    case null:
      return "null";
    case undefined:
      return "undefined";
    case 0n:
      return "big zero";
    default:
      return "default";
  }
}
console.log([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => bySwitch(zeroLike(n))).join());
console.log(bySwitch(zeroLike(0)), bySwitch(zeroLike(1)), bySwitch(zeroLike(7)), bySwitch(zeroLike(8)), bySwitch(zeroLike(9)));

// Arithmetic and text with them.
console.log([0, 1, 2, 3, 4, 5, 6, 7, 9].map(n => String((zeroLike(n) as any) + 1)).join(), [0, 1, 2, 3, 4, 5, 6, 7, 9].map(n => String((zeroLike(n) as any) * 1)).join(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => "<" + zeroLike(n) + ">").join(""));
console.log(1 / (zeroLike(0) as number), 1 / (zeroLike(1) as number), 1 / ((zeroLike(1) as number) + 0), 1 / ((zeroLike(1) as number) * 1), 1 / -(zeroLike(0) as number), 1 / Number(zeroLike(2)), 1 / Number(zeroLike(5)), Number(zeroLike(6)), Number(zeroLike(9)));

// Small integers as indexes, shifts, bounds, keys.
const table = ["low", "middle", "high"];
console.log(table[level(5)], table[level(50)], table[level(500)], 1 << level(500), [10, 20, 30].slice(level(50)).join(), "abc".charAt(level(500)), { 0: "zero", 1: "one", 2: "two" }[level(50)], table[sign(-5) + 1], table[sign(0) + 1], table[sign(5) + 1], sign(NaN), sign(-0), Object.is(sign(-0), 0));

// A constant object is one object.
console.log(listOr(0) === listOr(0), listOr(0) === EMPTY, listOr(1) === listOr(1), optionOf(0) === NONE, optionOf(0) === optionOf(0), optionOf(1) === optionOf(1), Object.isFrozen(listOr(0)), Object.isFrozen(listOr(1)), new Set([optionOf(0), optionOf(0), optionOf(1), optionOf(1)]).size);
function isNone(o: { kind: string }): boolean {
  return o === NONE;
}
console.log(isNone(optionOf(0)), isNone(optionOf(1)), isNone({ kind: "none" }), isNone(Object.freeze({ kind: "none" })), isNone(structuredClone(NONE)));

// The list of constants is complete only as long as the function returns in the listed ways.
function levelOrWorse(n: number): number {
  try {
    if (n > 1000) throw 3;
    return level(n);
  } catch (thrown) {
    return thrown as number;
  }
}
function branchOn(n: number): string {
  const l = levelOrWorse(n);
  if (l === 0) return "zero";
  if (l === 1) return "one";
  if (l === 2) return "two";
  return "something else: " + l;
}
console.log(branchOn(1), branchOn(50), branchOn(500), branchOn(5000));
console.log(unit(0) + unit(1) + unit(2), unit(NaN), unit(-0), level(NaN), level(-Infinity), level("5" as unknown as number), level(undefined as unknown as number), flag(NaN), flag(0.5), nothing(1.5));
