// The plain deeds: a loop over what Object.keys(), Object.values(), Object.getOwnPropertyNames(), Reflect.ownKeys() and split() have just made, over records, lists, texts and nothing at all.
function keys(o: object) { let seen = ""; for (const k of Object.keys(o)) seen += k + ","; return seen; }
function values(o: Record<string, unknown>) { let seen = ""; for (const v of Object.values(o)) seen += String(v) + ","; return seen; }
function names(o: object) { let seen = ""; for (const k of Object.getOwnPropertyNames(o)) seen += k + ","; return seen; }
function own(o: object) { let seen = ""; for (const k of Reflect.ownKeys(o)) seen += String(k) + ","; return seen; }
function pieces(text: string, at: string) { let seen = ""; for (const p of text.split(at)) seen += "[" + p + "]"; return seen; }
function early(o: object) { for (const k of Object.keys(o)) { if (k === "y") return k; } return "none"; }
function nested(o: Record<string, string>) { let seen = ""; for (const k of Object.keys(o)) for (const p of o[k].split("-")) seen += k + p + ","; return seen; }
const tag = Symbol("tag");
for (let round = 0; round < 3; round++) {
  console.log(keys({ x: 1, y: 2 }), keys([7, 8]), keys("ab" as any), keys({}), values({ x: 1, y: "two", z: null }), names([1]), own({ a: 1, [tag]: 2 }));
  console.log(pieces("a,b,,c", ","), pieces("", ","), pieces("abc", ""), pieces("abc", "x"), early({ x: 1, y: 2 }), early({}), nested({ a: "1-2", b: "3" }));
}
