// Members of a union of texts that only the type spells are put together at run time or parsed, and so are texts that are no member. They are printed, measured, compared, switched on, stored in fields, variables, arrays and maps, captured, and used as keys.
type Color = "red" | "green" | "blue" | "ultraviolet" | "";
type Box = { color: Color; next?: Color };
function make(parts: string[]): Color { return parts.join("") as Color; }
function fromJson(t: string): Box { return JSON.parse(t) as Box; }
function show(c: Color): string { return "<" + c + ":" + c.length + ":" + c.toUpperCase() + ">"; }
function pick(c: Color): number { switch (c) { case "red": return 1; case "green": return 2; default: return 9; } }
class Holder { c: Color = "red"; set(c: Color) { this.c = c; return this; } get() { return this.c; } }
let kept: Color = "red";
function keep(c: Color) { kept = c; } function give(): Color { return kept; }
const uv = make(["ultra", "vio", "let"]), bl = make(["bl", "ue"]), em = make([]), odd = make(["inf", "rared"]);
for (const c of [uv, bl, em, odd, "green" as Color]) {
  const h = new Holder().set(c); keep(c);
  console.log(show(c), pick(c), show(h.get()), show(give()), h.get() === c, give() === c, c === "red", [c].includes(give()), JSON.stringify({ c, h }), typeof give(), Object.keys({ [give()]: 1 }).join());
}
const b = fromJson('{"color":"ultraviolet","next":"blue"}'); console.log(show(b.color), show(b.next!), b.color === uv, b.next === bl, pick(b.color), b.color + b.next, `${b.color}`, b.color.charAt(2), b.color > b.next!, [b.color, b.next].sort().join());
const m = new Map<Color, number>(); m.set(uv, 1); m.set(b.color, 2); m.set(bl, 3); console.log(m.size, m.get("ultra" + "violet" as Color), m.get(b.next!), [...m.keys()].join());
const rec: Record<Color, number> = { red: 1, green: 2, blue: 3, ultraviolet: 4, "": 5 }; console.log(rec[uv], rec[bl], rec[em], rec[odd], rec[b.color]);
function eq(a: Color, b2: Color) { return a === b2; } console.log(eq(uv, b.color), eq(bl, b.next!), eq(uv, bl), eq(em, ""), eq(odd, odd), eq(odd, make(["infra", "red"])));
const arr: Color[] = []; for (let i = 0; i < 6; i++) arr.push(make([["ultra", "bl", "re", "gre", "", "x"][i], ["violet", "ue", "d", "en", "", "y"][i]])); console.log(arr.join("|"), arr.indexOf(uv), arr.indexOf("blue"), arr.map(pick).join(), arr.map(show).join(""));
type Kind = "alpha" | "beta" | "gamma"; interface Node_ { kind: Kind; v: number }
const nodes: Node_[] = JSON.parse('[{"kind":"gamma","v":1},{"kind":"beta","v":2},{"kind":"delta","v":3}]'); let s = ""; for (const n of nodes) s += n.kind + (n.kind === "alpha" ? "A" : "-") + n.kind.length; console.log(s);
function later(k: Kind) { return () => k; } console.log(nodes.map(n => later(n.kind)()).join());
