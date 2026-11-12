// a condition is a negation that was kept in a variable: of a typeof, an instanceof, an `in`, a comparison with NaN, a truth. The side that is taken and what is known on it are as written
class Point { x = 1; }
function byType(v: unknown) { const no = !(typeof v === "string"); if (no) return "other"; return "text" + (v as string).length; }
function byClass(v: unknown) { const no = !(v instanceof Point); if (no) return "other"; return "point" + (v as Point).x; }
function byName(v: object) { const no = !("x" in v); if (no) return "lacks"; return "has"; }
function byOrder(v: number) { const no = !(v < 1); if (no) return "not below"; return "below"; }
function byTruth(v: unknown) { const no = !v; const yes = !no; if (no) return "falsy" + yes; return "truthy" + yes; }
function inLoop(v: unknown) { const done = !v; let turns = 0; while (!done) { if (++turns > 2) break; } return turns; }
function deed(v: any) { return byType(v) + byClass(v) + (typeof v === "object" && v ? byName(v) : "") + byOrder(v) + byTruth(v) + inLoop(v); }
const values: unknown[] = ["ab", "", new Point(), { x: 2 }, {}, 0, 1, NaN, -0, null, undefined];
let text = "";
for (let i = 0; i < values.length; i++) text += deed(values[i]) + ";";
console.log(text);
text = "";
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 4; i++) text += deed(values[i]) + ";";
console.log(text);
