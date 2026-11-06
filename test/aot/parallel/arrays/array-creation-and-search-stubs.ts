// Arrays and `arguments` objects that stubs allocate (literals, empty arrays of a fixed, requested or learned capacity, arrays of holes, slices, copies), and `includes` and `indexOf` by stub: every fast path, every case that goes to the runtime, free lists that run out, and all of it again once arrays may inherit elements.
// CALLS+ mixedLiterals ArrayLiteral\.n4
// CALLS+ doubleLiterals ArrayLiteralWithDouble\.n4
// CALLS+ doubleLiterals NewEmptyArray\.
// CALLS+ filledConditionally NewEmptyArrayAtSite
// CALLS+ numbersFilledConditionally NewArrayWithLength
// CALLS+ checkSlices ArraySlice
// CALLS+ captureStrict CreateArguments
// CALLS+ searchStrings ArraySearch
const out: string[] = [];
const marker = { name: "marker" };
const texts = ["", "a", "ab", "abc", "abcd", "abcdefg", "abcdefgh", "abcdefghi", "abcdefghijklmnop", "abcdefghijklmnopq", "abcdefghijklmnopqrstuvwxyz0123456789"];

function show(value: unknown): string {
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(",") + "]";
  }
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === marker) return "marker";
  if (typeof value !== "object" || value === null) return String(value);
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Arguments]" ? "arguments" + show(Array.from(value as ArrayLike<unknown>)) : tag;
}

function digest(text: string): string {
  let hash = 0x811c9dc5 | 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}

function summarize(list: readonly unknown[]): string {
  let present = 0;
  for (let i = 0; i < list.length; i++) if (i in list) present++;
  return list.length + "/" + present + "/" + digest(show(list));
}

// Literals of 0 to 5 elements.
function mixedLiterals(n: number, s: string): unknown[][] {
  return [[], [n], [n, s], [n, s, marker], [n, s, marker, null], [n, s, marker, null, true]];
}
function int32Literals(n: number): number[][] {
  const i = n | 0;
  return [[], [i], [i, i ^ 1], [i, i ^ 1, i ^ 2], [i, i ^ 1, i ^ 2, i ^ 3], [i, i ^ 1, i ^ 2, i ^ 3, i ^ 4]];
}
function doubleLiterals(x: number): number[][] {
  return [[], [x], [x, x * 2], [x, x * 2, x * 3], [x, x * 2, x * 3, x * 4], [x, x * 2, x * 3, x * 4, x * 5]];
}
function optionalLiterals(x: number | undefined, y: number | undefined): (number | undefined)[][] {
  return [[], [x], [x, y], [y, x, y], [x, y, x, y], [x, y, x, y, x]];
}
function nullableLiterals(x: number | null, y: number | null): (number | null)[][] {
  return [[], [x], [x, y], [y, x, y], [x, y, x, y], [x, y, x, y, x]];
}

function literalReport(): void {
  const groups: [string, unknown[][]][] = [
    ["mixed", mixedLiterals(7, "s")],
    ["int32", int32Literals(40)],
    ["double", doubleLiterals(0.5)],
    ["integral double", doubleLiterals(2)],
    ["NaN", doubleLiterals(NaN)],
    ["negative zero", doubleLiterals(-0)],
    ["infinity", doubleLiterals(Infinity)],
    ["optional", optionalLiterals(1.5, undefined)],
    ["optional, none present", optionalLiterals(undefined, undefined)],
    ["optional, all present", optionalLiterals(1.5, 2.5)],
    ["optional with NaN", optionalLiterals(NaN, 2.5)],
    ["nullable", nullableLiterals(1.5, null)],
  ];
  for (const [name, lists] of groups) {
    out.push(name + " " + show(lists));
    for (const list of lists) list.push(name.length);
    out.push(name + ", pushed " + show(lists));
  }
}

// Empty arrays. A counted loop tells the compiler the capacity. A conditional push leaves it to the allocation site, which learns it.
function filledInCountedLoop(count: number): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; i < count; i++) list.push(texts[i & 7]);
  return list;
}
function filledConditionally(count: number, skipped: number): unknown[] {
  const list: unknown[] = [];
  for (let i = 0; list.length < count; i++) {
    if (i !== skipped) list.push(texts[i & 7]);
  }
  return list;
}
function numbersFilledConditionally(count: number, skipped: number, step: number): number[] {
  const list: number[] = [];
  for (let i = 0; list.length < count; i++) {
    if (i !== skipped) list.push(i * step);
  }
  return list;
}

function emptyArrayReport(): void {
  for (const count of [0, 1, 3, 5, 9, 200]) {
    let lengths = 0;
    let shown = "";
    for (let run = 0; run < 1000; run++) {
      const boxed = filledConditionally(count, run & 3);
      const int32s = numbersFilledConditionally(count, run & 3, 1);
      const doubles = numbersFilledConditionally(count, run & 3, 0.5);
      lengths += boxed.length + int32s.length + doubles.length;
      if (run % 250 === 0) shown += show(boxed) + show(int32s) + show(doubles);
    }
    out.push("site filled to " + count + ": " + lengths + " " + digest(shown));
  }
  for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 126, 127, 128, 129, 2000]) out.push("capacity " + count + ": " + summarize(filledInCountedLoop(count)));
}

// Arrays created with a length.
function holeReport(): void {
  for (const n of [0, 1, 2, 127, 128, 2000]) {
    const source: number[] = [];
    for (let i = 0; i < n; i++) source.push(i);
    const lists: [string, unknown[], unknown][] = [
      ["new Array of numbers", new Array<number>(n), 4.5],
      ["new Array of strings", new Array<string>(n), "t"],
      ["Array.from a length", Array.from({ length: n }), marker],
      ["Array.from with a function", Array.from({ length: n }, (_, i) => i * 2), 4],
      ["map to doubles", source.map(x => x + 0.5), 4],
      ["map to int32", source.map(x => (x * 3) | 0), 4.5],
      ["map to strings", source.map(x => "n" + x), "t"],
      ["map to either", source.map(x => (x & 1 ? x : "e" + x)), "t"],
    ];
    for (const [name, list, extra] of lists) {
      const created = summarize(list);
      if (n) list[n - 1] = extra;
      list.push(extra);
      out.push(name + " " + n + ": " + created + " " + summarize(list));
    }
  }
}

// slice.
const bounds = [-70, -1, 0, 1, 63, 64, 65, 70];

function expectedSlice<T>(source: readonly T[], from: number, to: number): T[] {
  const length = source.length;
  const start = from < 0 ? Math.max(length + from, 0) : Math.min(from, length);
  const end = to < 0 ? Math.max(length + to, 0) : Math.min(to, length);
  const result: T[] = [];
  for (let i = start; i < end; i++) result.push(source[i]);
  return result;
}

function checkSlices<T>(name: string, source: T[], extra: T): void {
  const before = JSON.stringify(source);
  let wrong = 0;
  let shown = "";
  const examine = (result: T[], expected: T[]) => {
    if (!Array.isArray(result) || result.length !== expected.length || JSON.stringify(result) !== JSON.stringify(expected)) wrong++;
    result.push(extra);
    if (result.length !== expected.length + 1 || result[expected.length] !== extra) wrong++;
    shown += JSON.stringify(result);
  };
  examine(source.slice(), expectedSlice(source, 0, source.length));
  for (const from of bounds) {
    examine(source.slice(from), expectedSlice(source, from, source.length));
    for (const to of bounds) examine(source.slice(from, to), expectedSlice(source, from, to));
  }
  if (JSON.stringify(source) !== before) wrong++;
  out.push("slices of " + source.length + " " + name + ": " + wrong + " wrong, " + digest(shown));
}

function sliceLiteral(length: number, from: number, to: number): number[] {
  switch (length) {
    case 1:
      return [100].slice(from, to);
    case 2:
      return [100, 101].slice(from, to);
    case 64:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163].slice(from, to);
    case 65:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164].slice(from, to);
    default:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169].slice(from, to);
  }
}
function copyLiteral(length: number): number[] {
  switch (length) {
    case 1:
      return [100].slice();
    case 2:
      return [100, 101].slice();
    case 64:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163].slice();
    case 65:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164].slice();
    default:
      return [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169].slice();
  }
}
function sliceDoubleLiteral(from: number, to: number): number[] {
  return [0.5, 1.5, 2.5].slice(from, to);
}
function sliceStringLiteral(from: number, to: number): string[] {
  return ["a", "b", "c"].slice(from, to);
}

function checkLiteralSlices(length: number): void {
  const source: number[] = [];
  for (let i = 0; i < length; i++) source.push(100 + i);
  let wrong = 0;
  for (let round = 0; round < 2; round++) {
    const copy = copyLiteral(length);
    if (JSON.stringify(copy) !== JSON.stringify(source)) wrong++;
    copy.push(-1);
    copy[0] = -2;
    for (const from of bounds) {
      for (const to of bounds) {
        const result = sliceLiteral(length, from, to);
        if (!Array.isArray(result) || JSON.stringify(result) !== JSON.stringify(expectedSlice(source, from, to))) wrong++;
        result.push(-1);
        result[0] = -2;
      }
    }
  }
  out.push("slices of a literal of " + length + ": " + wrong + " wrong");
}

class Derived extends Array<number> {}

function sliceReport(): void {
  for (const length of [0, 1, 2, 64, 65, 70]) {
    const int32s: number[] = [];
    const doubles: number[] = [];
    const boxed: unknown[] = [];
    for (let i = 0; i < length; i++) {
      int32s.push(i);
      doubles.push(i + 0.5);
      boxed.push(i % 3 ? "s" + i : i);
    }
    checkSlices("int32", int32s, 7);
    checkSlices("double", doubles, 7.5);
    checkSlices("boxed", boxed, "extra");
    if (length) checkLiteralSlices(length);
  }
  for (const from of [-4, -1, 0, 1, 3]) {
    const doubles = sliceDoubleLiteral(from, 2);
    const strings = sliceStringLiteral(from, 3);
    doubles.push(9);
    strings.push("z");
    out.push("literal slices from " + from + ": " + show(doubles) + " " + show(strings));
  }

  const int32sWithHole: number[] = [1, , 3, 4] as number[];
  const doublesWithHole: number[] = [0.5, , 2.5, 3.5] as number[];
  const boxedWithHole: unknown[] = ["a", , marker, undefined];
  out.push("holes: " + show(int32sWithHole.slice()) + " " + show(int32sWithHole.slice(1, 3)) + " " + show(doublesWithHole.slice()) + " " + show(doublesWithHole.slice(1, 2)) + " " + show(boxedWithHole.slice()) + " " + show(boxedWithHole.slice(-3)));

  const derived = new Derived();
  derived.push(1, 2, 3);
  const derivedAsArray: number[] = derived;
  const partOfDerived = derivedAsArray.slice(1);
  const copyOfDerived = derivedAsArray.slice();
  out.push("species: " + (partOfDerived instanceof Derived) + " " + show(partOfDerived) + " " + (copyOfDerived instanceof Derived) + " " + show(copyOfDerived));

  const withoutConstructor: number[] = [1, 2, 3];
  (withoutConstructor as any).constructor = undefined;
  const withDerivedConstructor: number[] = [1, 2, 3];
  (withDerivedConstructor as any).constructor = Derived;
  out.push("own constructor: " + (withoutConstructor.slice(1) instanceof Derived) + " " + show(withoutConstructor.slice(1)) + " " + show(withoutConstructor.slice()) + " " + (withDerivedConstructor.slice(1) instanceof Derived) + " " + show(withDerivedConstructor.slice(1)) + " " + (withDerivedConstructor.slice() instanceof Derived));

  const frozen: readonly number[] = Object.freeze([1, 2, 3]);
  const copyOfFrozen = frozen.slice();
  const partOfFrozen = frozen.slice(1, 3);
  copyOfFrozen.push(4);
  partOfFrozen[0] = 9;
  out.push("frozen: " + show(copyOfFrozen) + " " + show(partOfFrozen) + " " + show(frozen) + " " + Object.isFrozen(copyOfFrozen));

  const sparse: number[] = [1, 2, 3];
  sparse[100000] = 9;
  out.push("sparse: " + show(sparse.slice(0, 2)) + " " + show(sparse.slice(-1)) + " " + sparse.slice().length);
}

// arguments.
const captureStrict: (...values: unknown[]) => IArguments = function () {
  "use strict";
  return arguments;
};
const capturePlain: (...values: unknown[]) => IArguments = function () {
  return arguments;
};

function describeArguments(list: IArguments, callee: unknown): string {
  let calleeText: string;
  try {
    calleeText = list.callee === callee ? "own function" : typeof list.callee;
  } catch (error) {
    calleeText = (error as Error).name;
  }
  const spread: unknown[] = [...list];
  const iterates = list[Symbol.iterator] === Array.prototype.values;
  return [list.length, calleeText, iterates, Reflect.ownKeys(list).map(String).join("|"), JSON.stringify(Object.getOwnPropertyDescriptor(list, "length")), show(list), show(spread)].join(" ");
}

function argumentValues(kind: string, count: number): unknown[] {
  const values: unknown[] = [];
  for (let i = 0; i < count; i++) values.push(kind === "int32" ? i : kind === "double" ? i + 0.5 : kind === "optional" ? (i & 1 ? undefined : i) : i % 3 ? "t" + i : marker);
  return values;
}

function argumentsReport(): void {
  for (const kind of ["int32", "double", "optional", "mixed"]) {
    let strict = "";
    let plain = "";
    for (let count = 0; count <= 70; count++) {
      const values = argumentValues(kind, count);
      strict += describeArguments(captureStrict(...values), captureStrict);
      plain += describeArguments(capturePlain(...values), capturePlain);
    }
    out.push("arguments, " + kind + ": " + digest(strict) + " " + digest(plain));
    for (const count of [0, 1, 2, 5]) {
      const values = argumentValues(kind, count);
      out.push("strict " + describeArguments(captureStrict(...values), captureStrict));
      out.push("plain " + describeArguments(capturePlain(...values), capturePlain));
    }
  }
  out.push("direct " + describeArguments(captureStrict(), captureStrict));
  out.push("direct " + describeArguments(captureStrict(1), captureStrict));
  out.push("direct " + describeArguments(captureStrict(1, "a"), captureStrict));
  out.push("direct " + describeArguments(captureStrict(1.5, 2.5), captureStrict));
  out.push("direct " + describeArguments(captureStrict(undefined), captureStrict));
  out.push("direct " + describeArguments(captureStrict(marker, null, true, 4), captureStrict));
  const changed = captureStrict(1, 2, 3);
  changed[0] = "changed";
  changed[5] = "added";
  changed.length = 2;
  out.push("changed " + show(changed) + " " + changed[2] + " " + changed[5] + " " + Reflect.ownKeys(changed).map(String).join("|"));
}

// includes and indexOf. The list and the search element are created again for each call, because a call may flatten a rope.
function fresh(text: string): string {
  return text.split("").join("");
}
function rope(text: string): string {
  const middle = text.length >> 1;
  return fresh(text.slice(0, middle)) + fresh(text.slice(middle));
}
function atomized(text: string): string {
  return Object.keys({ [fresh(text)]: 1 })[0];
}

function startsFor(length: number): number[] {
  return [0, 1, length - 1, length, length + 1, -1, -length, -length - 1, 0.5, -0.5];
}
function search(name: string, createList: () => unknown[], createSearchElement: () => unknown): void {
  let line = name + ": " + createList().indexOf(createSearchElement()) + " " + createList().includes(createSearchElement());
  for (const start of startsFor(createList().length)) line += " " + createList().indexOf(createSearchElement(), start) + (createList().includes(createSearchElement(), start) ? "+" : "-");
  out.push(line);
}
function searchNumbers(name: string, list: number[], searchElement: number): void {
  let line = name + ": " + list.indexOf(searchElement) + " " + list.includes(searchElement);
  for (const start of startsFor(list.length)) line += " " + list.indexOf(searchElement, start) + (list.includes(searchElement, start) ? "+" : "-");
  out.push(line);
}
function searchStrings(name: string, list: string[], searchElement: string): void {
  let line = name + ": " + list.indexOf(searchElement) + " " + list.includes(searchElement);
  for (const start of startsFor(list.length)) line += " " + list.indexOf(searchElement, start) + (list.includes(searchElement, start) ? "+" : "-");
  out.push(line);
}

function searchForPrimitives(): void {
  const half = texts.length / 22;
  const one = half + half;
  search("int32 in int32", () => [1, 2, 3, 4], () => 3);
  search("first int32", () => [1, 2, 3, 4], () => 1);
  search("last int32", () => [1, 2, 3, 4], () => 4);
  search("repeated int32", () => [1, 2, 1, 2], () => 2);
  search("absent int32", () => [1, 2, 3, 4], () => 9);
  search("int32 in mixed", () => ["a", 1, marker, 3], () => 3);
  search("int32 after a double", () => ["a", 2.5, 3], () => 3);
  search("int32 before a double", () => ["a", 3, 2.5], () => 3);
  search("absent int32 in mixed", () => ["3", marker, null, true], () => 3);
  search("1 against 1.0", () => ["a", one, marker], () => 1);
  search("1.0 against 1", () => ["a", 1, marker], () => one);
  search("double", () => ["a", 2.5, 3], () => 2.5);
  search("absent double", () => ["a", 2.5, 3], () => 2.25);
  search("NaN", () => ["a", NaN, 3], () => NaN);
  search("absent NaN", () => ["a", 2.5, 3], () => NaN);
  search("0 against -0", () => ["a", -0], () => 0);
  search("-0 against 0", () => ["a", 0], () => -0);
  search("int32 after a hole", () => [1, , 3], () => 3);
  search("undefined against a hole", () => [1, , 3], () => undefined);
  search("undefined", () => [1, undefined, 3], () => undefined);
  search("absent undefined", () => [1, null, 3], () => undefined);
  search("null", () => [1, null, "a"], () => null);
  search("absent null", () => [1, undefined, , "null"], () => null);
  search("true", () => [0, 1, false, true], () => true);
  search("false", () => [0, 1, false, true], () => false);
  search("absent boolean", () => [0, 1, "true", null], () => true);
  search("bigint", () => [1, BigInt(1), 2n], () => 1n);
  search("absent bigint", () => [1, "1", 2n], () => 1n);
  search("empty list", () => [], () => 1);
  search("string in an empty list", () => [], () => fresh("abc"));

  searchNumbers("numbers, int32", [1, 2, 3, 4], 3);
  searchNumbers("numbers, absent int32", [1, 2, 3, 4], 2.5);
  searchNumbers("numbers, double", [0.5, 1.5, 2.5], 1.5);
  searchNumbers("numbers, int32 in doubles", [0.5, 2, 2.5], 2);
  searchNumbers("numbers, NaN", [0.5, 1.5, 2.5], NaN);
  searchNumbers("numbers, NaN present", [0.5, NaN, 2.5], NaN);
  const evens: number[] = [];
  for (let i = 0; i < 65; i++) evens.push(i * 2);
  searchNumbers("numbers, 65 int32", evens, 128);
  searchNumbers("numbers, 65 int32, absent", evens, 127);
  searchNumbers("numbers, 31 int32", evens.slice(0, 31), 60);
}

function searchByIdentity(): void {
  const object = { id: 1 };
  const other = { id: 1 };
  const symbol = Symbol("s");
  const otherSymbol = Symbol("s");
  search("object", () => [other, object, marker], () => object);
  search("absent object", () => [other, marker, "[object Object]"], () => object);
  search("array", () => [[], bounds, texts], () => bounds);
  search("function", () => [search, show, digest], () => show);
  search("symbol", () => [otherSymbol, symbol, "s"], () => symbol);
  search("absent symbol", () => [otherSymbol, "Symbol(s)", Symbol.iterator], () => symbol);

  const objects: object[] = [];
  const strings: string[] = [];
  const mixed: unknown[] = [];
  for (let i = 0; i < 65; i++) {
    objects.push({ i });
    strings.push("element " + i);
    mixed.push(i & 1 ? i : "element " + i);
  }
  for (const length of [64, 65]) {
    search(length + " objects, last", () => objects.slice(0, length), () => objects[length - 1]);
    search(length + " objects, first", () => objects.slice(0, length), () => objects[0]);
    search(length + " objects, absent", () => objects.slice(0, length), () => marker);
    search(length + " objects, null", () => objects.slice(0, length), () => null);
    search(length + " strings, last", () => strings.slice(0, length), () => fresh(strings[length - 1]));
    search(length + " strings, absent", () => strings.slice(0, length), () => fresh("element 99"));
    search(length + " mixed, last int32", () => mixed.slice(0, length), () => 63);
    search(length + " mixed, absent int32", () => mixed.slice(0, length), () => 64);
  }
}

function searchForStrings(): void {
  for (const text of texts) {
    const size = text.length;
    search("literal in literals " + size, () => texts, () => text);
    search("fresh in literals " + size, () => texts, () => fresh(text));
    search("fresh in fresh " + size, () => texts.map(fresh), () => fresh(text));
    search("atom in atoms " + size, () => texts.map(atomized), () => atomized(text));
    search("atom in fresh " + size, () => texts.map(fresh), () => atomized(text));
    searchStrings("strings " + size, texts.map(fresh), fresh(text));
    if (!size) continue;
    search("last character differs " + size, () => texts.map(fresh), () => fresh(text.slice(0, -1) + "#"));
    search("first character differs " + size, () => texts.map(fresh), () => fresh("#" + text.slice(1)));
    search("absent atom " + size, () => texts.map(atomized), () => atomized(text.slice(0, -1) + "#"));
    if (size < 2) continue;
    search("rope in fresh " + size, () => texts.map(fresh), () => rope(text));
    search("fresh in ropes " + size, () => texts.map(each => (each.length > 1 ? rope(each) : each)), () => fresh(text));
    search("absent in ropes " + size, () => texts.map(each => (each.length > 1 ? rope(each) : each)), () => fresh(text.slice(0, -1) + "#"));
  }
  const wide = ["abcdefg\u0416", "\u0416", "abcdefgh", "\u0416bcdefgh"];
  for (const text of wide) {
    search("16-bit " + text.length, () => wide.map(fresh), () => fresh(text));
    search("16-bit, same cell " + text.length, () => wide, () => text);
  }
  search("absent 16-bit", () => texts.map(fresh), () => fresh("abcdefg\u0416"));
  search("absent 8-bit among 16-bit", () => [wide[0], wide[1], wide[3]].map(fresh), () => fresh("abcdefgh"));
  search("string among other values", () => [1, null, marker, undefined, , Symbol.iterator, 2.5, fresh("abcd")], () => fresh("abcd"));
  search("number as text", () => [1, 2, 3], () => fresh("2"));
}

// Free lists that run out: the results stay alive for 32 allocations.
const ring: unknown[] = [];
for (let i = 0; i < 32; i++) ring.push(null);
let cursor = 0;
function retain(list: ArrayLike<unknown>): number {
  ring[cursor++ & 31] = list;
  return list.length;
}

function churn(rounds: number): void {
  const int32s = [1, 2, 3, 4, 5];
  const doubles = [0.5, 1.5, 2.5, 3.5];
  const boxed: unknown[] = ["a", marker, 3];
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const s = texts[i & 7];
    const x = i + 0.5;
    const u = i & 1 ? undefined : x;
    total += retain([]) + retain([i]) + retain([i, s]) + retain([i, s, marker]) + retain([i, s, marker, null]) + retain([i, s, marker, null, true]);
    total += retain([x]) + retain([x, x]) + retain([x, x, x]) + retain([x, x, x, x]) + retain([u, x]) + retain([i, i ^ 1, i ^ 2]);
    total += retain(filledConditionally(i & 7, 2)) + retain(filledInCountedLoop(i & 15)) + retain(numbersFilledConditionally(i & 3, 1, 0.5)) + retain(numbersFilledConditionally(i & 3, 1, 1));
    total += retain(new Array<number>(i & 7)) + retain(new Array<string>(i & 3)) + retain(Array.from({ length: i & 3 }));
    total += retain(doubles.map(each => each + i)) + retain(int32s.map(each => each ^ i)) + retain(boxed.map(each => each));
    total += retain(int32s.slice()) + retain(int32s.slice(1, 3)) + retain(doubles.slice(i & 3)) + retain(doubles.slice()) + retain(boxed.slice(-2)) + retain(boxed.slice(1, 2));
    total += retain(captureStrict(i, s)) + retain(captureStrict()) + retain(captureStrict(i, i, i, i, i)) + retain(capturePlain(i));
  }
  out.push("churn " + rounds + ": " + total + " " + show(ring));
}

function report(): void {
  literalReport();
  emptyArrayReport();
  holeReport();
  sliceReport();
  argumentsReport();
  searchForPrimitives();
  searchByIdentity();
  searchForStrings();
}

report();
churn(300000);

// An accessor for an index on a prototype of arrays: from here on no array has plain storage, and no stub may allocate one.
class WithIndexAccessor extends Array<number> {}
Object.defineProperty(WithIndexAccessor.prototype, 1, { get() { return -1; }, set(_value: number) {}, configurable: true });
const intercepted = new WithIndexAccessor();
intercepted.push(1, 2, 3);
out.push("intercepted " + intercepted.length + " " + intercepted[0] + " " + intercepted[1] + " " + intercepted[2]);
report();
churn(3000);
console.log(out.join("\n"));
