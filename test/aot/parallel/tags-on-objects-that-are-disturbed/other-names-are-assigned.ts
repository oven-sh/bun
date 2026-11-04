type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number } | { kind: "none" } | { kind: "tri"; a: number } | { kind: "line"; l: number };
function area(x: Shape): unknown { if (x.kind === "circle") return x.r * 3; if (x.kind === "square") return x.s * x.s; return "rest:" + x.kind; }
function turned(x: Shape): unknown { if ("circle" === x.kind) return x.r; if ("square" !== x.kind) return "rest:" + x.kind; return x.s; }
function row(x: Shape): unknown { if (x.kind === "circle") return x.r; if (x.kind === "square") return x.s; if (x.kind === "tri") return x.a; if (x.kind === "line") return x.l; return "none:" + x.kind; }
let noted = 0; function note(): void { noted++; }
function rowWithCalls(x: Shape): unknown { if (x.kind === "circle") return x.r; note(); if (x.kind === "square") return x.s; note(); if (x.kind === "tri") return x.a; note(); if (x.kind === "line") return x.l; return "none:" + x.kind; }
function cases(x: Shape): unknown { switch (x.kind) { case "circle": return "c" + x.r; case "tri": case "line": return "t" + (x as any).a + (x as any).l; case "square": return "s" + x.s; case "none": return "n"; default: return "other:" + (x as any).kind; } }
function answer(x: Shape): unknown { return x.kind === "tri"; }
function all(x: Shape): string { return area(x) + "," + turned(x) + "," + row(x) + "," + rowWithCalls(x) + "," + cases(x) + "," + answer(x); }
const circle = (): Shape => ({ kind: "circle", r: 2 });
const square = (): Shape => ({ kind: "square", s: 3 });
const none = (): Shape => ({ kind: "none" });
const tri = (): Shape => ({ kind: "tri", a: 4 });
const line = (): Shape => ({ kind: "line", l: 5 });
function both(x: Shape, round: number): string { const before = all(x); deed(x, round); return before + " > " + all(x); }
function deed(x: Shape, round: number): void { Object.assign(x, { r: 20 + round, extra: 1 }); }
for (let round = 0; round < 3; round++) console.log(both(circle(), round), "|", both(square(), round), "|", both(none(), round), "|", both(tri(), round), "|", both(line(), round));
