interface Small { kind: "box"; w: number } interface Large { kind: "box"; w: number; h: number } interface Ball { kind: "ball"; r: number } interface Rod { kind: "rod"; l: number }
type Any = Small | Large | Ball | Rod;
const make = (i: number): Any => i % 4 == 0 ? { kind: "box", w: i } : i % 4 == 1 ? { kind: "box", w: i, h: 2 } : i % 4 == 2 ? { kind: "ball", r: i } : { kind: "rod", l: i };
function size(x: Any): number { if (x.kind === "box") return x.w * ("h" in x ? x.h : 1); if (x.kind === "ball") return x.r; return x.l; }
function cases(x: Any): string { switch (x.kind) { case "ball": return "b" + x.r; case "box": return "x" + x.w + ("h" in x ? "h" : ""); case "rod": return "r" + x.l; } }
let out = ""; for (let i = 0; i < 9; i++) out += size(make(i)) + ":" + cases(make(i)) + " "; console.log(out);
