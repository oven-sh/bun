// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function all(name: string) { const seen: unknown[] = []; for (const value of box[name]) { seen.push(value); if (seen.length > 9) break; } return seen; }
const ofMaps = new Map().values().next, ofSets = new Set().values().next, ofLists = [].values().next, ofGenerators = (function* () {})().next;
const self = function (this: unknown) { return this; };
const kinds: [string, () => any][] = [["a Map iterator", () => new Map([[1, 2]]).values()], ["a Set iterator", () => new Set([3]).values()], ["a list iterator", () => [4].values()], ["a generator", () => (function* () { yield 5; })()], ["an object", () => ({})], ["a function", () => function () {}], ["a Map", () => new Map([[6, 7]])]];
for (const [method, next] of [["Maps", ofMaps], ["Sets", ofSets], ["lists", ofLists], ["generators", ofGenerators]] as const) {
  for (const [kind, make] of kinds) {
    box.mixed = make(); Object.defineProperty(box.mixed, "next", { value: next, configurable: true }); Object.defineProperty(box.mixed, Symbol.iterator, { value: self, configurable: true });
    attempt("next of " + method + " on " + kind + ":", () => all("mixed"));
  }
}
for (const primitive of [5, "text", true, 10n, Symbol.iterator, null, undefined]) {
  box.gives = { [Symbol.iterator]() { return primitive; } }; attempt("the method gives " + String(primitive) + ":", () => all("gives"));
}
box.bound = { next: ofSets.bind(new Set([1, 2]).values()), [Symbol.iterator]: self }; say(all("bound"));
box.inherits = Object.create(new Set([8]).values()); attempt("an object below a Set iterator:", () => all("inherits"));
