// Array.from(text) against [...text]: code points, lone surrogates, the empty text, ropes, slices, texts of 16 bits, a String object, what is no text, a mapper, and Array.from under another `this`.
const said: string[] = [];
const show = (list: unknown[]) => list.length + ":" + list.map(part => typeof part === "string" ? Array.prototype.map.call(part, (c: string) => c.charCodeAt(0).toString(16)).join("+") : String(part)).join(",");
function both(text: string) { const from = Array.from(text), spread = [...text]; said.push(show(from) + (show(from) === show(spread) ? " same" : " DIFFERS " + show(spread)) + (Array.isArray(from) ? "" : " no list")); }
function ofAnything(items: any) { try { return show(Array.from(items)); } catch (e) { return (e as Error).constructor.name; } }
for (const text of ["", "a", "abc", "a\u{1F600}b", "\ud83d", "\ude00\ud83d", "é中", "x".repeat(40) + "\u{10FFFF}"]) both(text);
let rope = ""; for (let i = 0; i < 5; i++) rope += "r" + i; both(rope); both(rope.slice(2, 7)); both(("中" + rope).substring(1));
for (const items of [new String("ab"), 5, null, undefined, true, { length: 2, 0: "p", 1: "q" }, ["l", , "m"], new Set(["s"]), new Map([["k", 1]]), "ab"[Symbol.iterator](), Symbol.iterator]) said.push(ofAnything(items));
said.push(show(Array.from("abc", (c, i) => c + i)));
class Other { length = 0; [index: number]: unknown }
said.push(String((Array.from as any).call(Other, "xy") instanceof Other) + String(Array.isArray((Array.from as any).call(undefined, "xy"))));
const made = Array.from("ab"); made.push("c"); (made as any).extra = 1; said.push(show(made) + Object.keys(made).join());
let total = 0; for (let round = 0; round < 2000; round++) total += Array.from(round & 1 ? "odd\u{1F600}" : "even").length; said.push(String(total));
console.log(said.join("\n"));
