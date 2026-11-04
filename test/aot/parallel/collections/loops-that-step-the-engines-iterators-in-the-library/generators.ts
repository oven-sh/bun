// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has.
const box: any = {}; (globalThis as any).box = box;
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "symbol" || typeof part === "bigint" ? String(part) : Object.is(part, -0) ? "-0" : typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \(evaluating .*\)$/, "")); } };
function all(name: string) { const seen: unknown[] = []; for (const value of box[name]) { seen.push(value); if (seen.length > 9) break; } return seen; }
const log: string[] = [];
box.plain = (function* () { yield 1; yield 2; return 3; })(); say(all("plain"), box.plain.next());
box.empty = (function* () {})(); say(all("empty"));
box.throws = (function* () { yield 1; throw new Error("in the generator"); })(); attempt("a generator that throws:", () => all("throws")); say(box.throws.next());
box.cleans = (function* () { try { yield 1; yield 2; } finally { log.push("finally"); } })(); for (const value of box.cleans) { log.push(String(value)); break; } say(log, box.cleans.next()); log.length = 0;
box.refuses = (function* () { try { yield 1; } finally { yield "from finally"; } })(); for (const _ of box.refuses) break; say(box.refuses.next());
box.itself = (function* (): any { yield 1; for (const value of box.itself) yield value; })(); attempt("a generator that iterates over itself:", () => all("itself"));
box.sees = (function* (): any { const sent = yield 1; log.push("sent " + String(sent)); const again = yield 2; log.push("sent " + String(again)); })(); say(all("sees"), log); log.length = 0;
box.finished = (function* () { yield 1; })(); box.finished.return(9); say(all("finished"));
box.begun = (function* () { yield 1; yield 2; yield 3; })(); box.begun.next(); say(all("begun"));
box.delegates = (function* () { yield* new Set([1, 2]); yield* new Map([[3, 4]]).values(); yield* [5].values(); yield* (function* () { yield 6; })(); })(); say(all("delegates"));
box.objects = (function* () { yield { done: true, value: "a value, no result" }; yield undefined; yield null; })(); say(all("objects"));
class Tree { constructor(public value: number, public below: Tree[] = []) {} *[Symbol.iterator](): Generator<number> { yield this.value; for (const child of this.below) yield* child; } }
box.tree = new Tree(1, [new Tree(2, [new Tree(3)]), new Tree(4)]); say(all("tree"));
box.many = (function* () { for (let i = 0; i < 100000; i++) yield i; })(); let sum = 0; for (const value of box.many) sum += value; say(sum);
box.asyncOne = (async function* () { yield 1; })(); attempt("an asynchronous generator in a plain loop:", () => all("asyncOne"));
