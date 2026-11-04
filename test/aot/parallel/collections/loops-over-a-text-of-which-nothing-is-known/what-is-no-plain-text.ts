// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has. Every loop stands in a function that is called several times.
const box: any = {}; (globalThis as any).box = box;
const units = (text: string) => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16)).join(".");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near) .*\)$/, "")); } };
function pieces(name: string) { const seen: string[] = []; for (const piece of box[name]) seen.push(units(piece)); return seen.join(" "); }
// A text in an object, an iterator of a text that the program holds, and what only looks like one: they go by the protocol as ever.
const log: string[] = []; const told = () => { const all = log.join(); log.length = 0; return all; };
class Below extends String {}
class Own extends String { [Symbol.iterator](): any { log.push("the method of the class"); return ["of the class"].values(); } }
const ofTexts = ""[Symbol.iterator]().next;
for (let turn = 0; turn < 3; turn++) {
  box.object = new String("ab"); box.below = new Below("cd"); box.own = new Own("ef"); say(pieces("object"), pieces("below"), pieces("own"), told());
  box.instance = new String("gh"); box.instance[Symbol.iterator] = function () { log.push("on the instance"); return ["x"].values(); }; say(pieces("instance"), told());
  box.held = "ab😀c"[Symbol.iterator](); say(box.held.next().value, pieces("held"), JSON.stringify(box.held.next()));
  box.kept = "abcd"[Symbol.iterator](); const seen: string[] = []; for (const piece of box.kept) { seen.push(piece); if (piece === "b") break; } say(seen, JSON.stringify(box.kept.next()), [...box.kept]);
  box.counted = "ab"[Symbol.iterator](); let calls = 0; box.counted.next = function () { calls++; return ofTexts.call(this); }; say(pieces("counted"), calls);
  box.closes = "ab"[Symbol.iterator](); box.closes.return = function () { log.push("return"); return {}; }; for (const _ of box.closes) break; say(told());
  box.borrowed = { next: ofTexts, [Symbol.iterator]() { return this; } }; attempt("the next of texts on an object:", () => pieces("borrowed"));
  box.onMap = new Map([[1, 2]]).values(); Object.defineProperty(box.onMap, "next", { value: ofTexts }); attempt("the next of texts on a Map iterator:", () => pieces("onMap"));
  box.looksAlike = { text: "zz", position: 0, next() { return { done: true }; }, [Symbol.iterator]() { return this; } }; say("[" + pieces("looksAlike") + "]");
  box.alike = { [Symbol.iterator]() { return { text: "zz", position: 0, next: ofTexts }; } }; attempt("an object with the fields and the next of texts:", () => pieces("alike"));
  box.proxy = new Proxy(new String("ij"), { get(target, key, receiver) { log.push("get " + String(key)); const found = Reflect.get(target, key, target); return typeof found === "function" ? found.bind(target) : found; } }); say(pieces("proxy"), told());
  box.list = ["k", "l"]; box.set = new Set(["m"]); box.gives = { [Symbol.iterator]() { return "no"[Symbol.iterator](); } }; box.generated = (function* () { yield* "pq"; })(); say(pieces("list"), pieces("set"), pieces("gives"), pieces("generated"));
  for (const odd of [5, true, 10n, Symbol.iterator, undefined, null, {}, () => {}]) { box.odd = odd; attempt(typeof odd + ":", () => pieces("odd")); }
}
