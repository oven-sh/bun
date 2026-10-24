// A regular expression literal, `new Map([..])`, `new Set([..])`, an object literal of constants, a class expression and a function expression each make a new object at every evaluation. A helper that "only uses" one may change it: `exec` on a global expression moves lastIndex, `add` and `delete` change a set. The next evaluation must not see it.
function firstMatch(re: RegExp, text: string): string {
  const m = re.exec(text);
  return m ? m[0] + "@" + m.index + ">" + re.lastIndex : "none>" + re.lastIndex;
}
function tests(re: RegExp, text: string): boolean {
  return re.test(text);
}
function globalOne(): RegExp {
  return /a./g;
}
function stickyOne(): RegExp {
  return /a/y;
}
let line = "";
const history: string[] = [];
for (let i = 0; i < 6; i++) {
  history.push(firstMatch(/a./g, "abacad"), String(tests(/a/y, "ab")), firstMatch(globalOne(), "abacad"), String(tests(stickyOne(), "ab")));
}
console.log(history.join(" "));
const one = /a./g;
console.log(firstMatch(one, "abacad"), firstMatch(one, "abacad"), firstMatch(one, "abacad"), firstMatch(one, "abacad"), firstMatch(one, "abacad"));
const isSame = (a: unknown, b: unknown): boolean => a === b;
console.log(globalOne() === globalOne(), isSame(/x/, /x/), new Set([/x/, /x/]).size);
function sameLiteralTwice(): boolean {
  const both: RegExp[] = [];
  for (let i = 0; i < 2; i++) both.push(/loop/g);
  both[0].lastIndex = 3;
  return both[0] === both[1] || both[1].lastIndex === 3;
}
console.log(sameLiteralTwice());
function marks(re: RegExp & { mark?: number }): number {
  re.mark = (re.mark ?? 0) + 1;
  return re.mark;
}
console.log(marks(/m/), marks(/m/), marks(globalOne()), marks(globalOne()));
// Built-ins that read and write lastIndex.
function viaBuiltIns(): string {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const re = /b/g;
    out.push("abcb".replace(re, "X") + re.lastIndex, "abcb".search(re) + "" + re.lastIndex, ("abcb".match(re) ?? []).length + "" + re.lastIndex, [..."abcb".matchAll(re)].length + "" + re.lastIndex, "abcb".split(re).length + "" + re.lastIndex, String(re.test("abcb")) + re.lastIndex);
  }
  return out.join();
}
console.log(viaBuiltIns());

// Maps and sets of constants.
function vowels(): Set<string> {
  return new Set(["a", "e", "i", "o", "u"]);
}
function digits(): Map<string, number> {
  return new Map([
    ["one", 1],
    ["two", 2],
  ]);
}
function hasOrAdds(set: Set<string>, x: string): boolean {
  if (set.has(x)) return true;
  set.add(x);
  return false;
}
function takes(map: Map<string, number>, key: string): number | undefined {
  const value = map.get(key);
  map.delete(key);
  return value;
}
let warm = 0;
for (let i = 0; i < 1000; i++) warm += (hasOrAdds(vowels(), "a") ? 1 : 0) + takes(digits(), "one")! + vowels().size + digits().size;
console.log(warm);
console.log(hasOrAdds(vowels(), "y"), hasOrAdds(vowels(), "y"), vowels().size, takes(digits(), "two"), takes(digits(), "two"), digits().size, vowels() === vowels(), digits() === digits());
const mySet = vowels();
mySet.clear();
const myMap = digits();
myMap.set("three", 3);
console.log(mySet.size, vowels().size, myMap.size, digits().size, [...vowels()].join(""), [...digits().keys()].join());
function inALoop(): string {
  const sizes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new Set([1, 2, 3]);
    s.delete(i + 1);
    s.add(10 + i);
    s.add(20);
    sizes.push(s.size, [...s][0]);
  }
  return sizes.join();
}
console.log(inALoop());

// Object literals of constants.
function defaults(): { retries: number; mode: string; nested: { deep: number[] } } {
  return { retries: 3, mode: "fast", nested: { deep: [1, 2] } };
}
function tweak(options: ReturnType<typeof defaults>): number {
  options.retries--;
  options.nested.deep.push(options.retries);
  return options.nested.deep.length;
}
for (let i = 0; i < 1000; i++) warm += defaults().retries + tweak(defaults());
console.log(warm, tweak(defaults()), tweak(defaults()), JSON.stringify(defaults()), defaults() === defaults(), defaults().nested === defaults().nested);
const frozenOnce = Object.freeze(defaults());
console.log(Object.isFrozen(frozenOnce), Object.isFrozen(defaults()), Object.isFrozen(frozenOnce.nested));

// Functions and classes.
function makeFunction(): { (): number; calls?: number } {
  return function () {
    return 1;
  };
}
function makeArrow(): () => number {
  return () => 2;
}
function makeClass() {
  return class Made {
    static count = 0;
  };
}
function countsCalls(f: { (): number; calls?: number }): number {
  f.calls = (f.calls ?? 0) + 1;
  return f.calls;
}
console.log(makeFunction() === makeFunction(), makeArrow() === makeArrow(), makeClass() === makeClass(), countsCalls(makeFunction()), countsCalls(makeFunction()), ++makeClass().count, ++makeClass().count, makeFunction().prototype === makeFunction().prototype, new (makeClass())() instanceof makeClass());

// Boxed primitives, dates, errors, typed arrays, symbols.
const makers: (() => object | symbol)[] = [() => new String("s"), () => new Number(1), () => new Date(0), () => new Error("e"), () => new Uint8Array(2), () => new ArrayBuffer(2), () => Symbol("s"), () => Object(1n), () => new WeakMap(), () => Promise.resolve(1), () => [], () => ({}), () => new Object(), () => Object.create(null), () => new Array(2), () => Array.of(1), () => "a,b".split(","), () => Object.keys({ a: 1 }), () => JSON.parse("{}"), () => structuredClone({})];
console.log(makers.map(make => make() === make()).join());
line = String(Symbol.for("shared") === Symbol.for("shared"));
console.log(line);
