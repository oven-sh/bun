// Ways for a value to differ from its static type that do not end in "a Dog that is a Cat". The type checker accepts every line under `strict`: there is no `any`, no cast, no user type guard and no declaration without a body.
// A compiled program prints what plain Bun prints, or throws a TypeError where a rule of the compiler says so. It never reads a value as something that it is not, and it never folds by a literal type.
// Here the compiled program may refuse the value with a TypeError at the typed place. The third operand of `t` is what plain Bun answers: that answer and a TypeError print the same text, anything else prints itself.
export {};
async function t(name: string, f: () => unknown, plain: string) { let r: string; try { r = String(await f()); } catch (e) { r = "threw " + (e instanceof Error ? e.name : typeof e); } console.log(name, r === plain || r === "threw TypeError" ? "the answer of plain Bun or a TypeError" : r); }
class Animal { name = "animal"; }
class Dog extends Animal { legs = 4; bark(): number { return this.legs * 2; } }
class Cat extends Animal { lives = "nine"; }
const later = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
namespace Settings { export const depth = 1; export let width = 1; export const read = (): string => [depth, width].join(); }
enum Color { Red, Green }
await t("an intersection of two kinds is read", () => { const both = Object.assign({ v: 1 }, { v: "text" }); const n: number = both.v; return [typeof n, n].join(); }, "string,text");
await t("a rest parameter gets what a shorter function type forgot", () => { const sum = (first: number, ...rest: number[]): number => rest.reduce((a, b) => a + b, first); const short: (first: number) => number = sum; const call = (f: (a: number, b: string) => number): number => f(1, "text"); return call(short); }, "1text");
await t("an exhaustive chain of tests falls through", () => { type Tag = { kind: "a" } | { kind: "b" }; const nameOf = (x: Tag): string => { if (x.kind === "a") return "A"; if (x.kind === "b") return "B"; return x; }; const o: { kind: "a" } = { kind: "a" }; const wide: { kind: string } = o; wide.kind = "c"; return typeof nameOf(o); }, "object");
await t("a value of type never is passed on", () => { type Tag = { kind: "a" } | { kind: "b" }; const fail = (x: never): string => "reached with " + JSON.stringify(x); const nameOf = (x: Tag): string => { switch (x.kind) { case "a": return "A"; case "b": return "B"; default: return fail(x); } }; const o: { kind: "a" } = { kind: "a" }; const wide: { kind: string } = o; wide.kind = "c"; return nameOf(o); }, "reached with {\"kind\":\"c\"}");
await t("a built-in constructs a subclass of Array with its own argument", () => { const seen: string[] = []; class Stack extends Array<number> { constructor(tag: string) { super(); seen.push(typeof tag, String(tag.length)); } } const s = new Stack("tag"); s.push(1, 2); const mapped = s.map(x => x * 2); return [seen.join(), mapped instanceof Stack, mapped.join()].join(" "); }, "string,3,number,undefined true 2,4");
