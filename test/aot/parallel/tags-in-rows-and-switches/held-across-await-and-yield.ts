type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number } | { kind: "none" } | { kind: "tri"; a: number } | { kind: "line"; l: number } | { kind: "dot"; d: number };
function area(x: Shape): unknown { if (x.kind === "circle") return x.r * 3; if (x.kind === "square") return x.s * x.s; return "none:" + x.kind; }
function name(x: Shape): unknown { switch (x.kind) { case "circle": return "c" + x.r; case "square": return "s" + x.s; default: return "n" + (x as any).r + (x as any).s; } }
function not(x: Shape): unknown { return x.kind !== "circle" ? (x.kind !== "square" ? "n" : x.s) : x.r; }
function show(run: () => unknown): string { try { return String(run()); } catch (error) { return (error as Error).constructor.name; } }
function row(x: Shape): unknown { if (x.kind === "circle") return x.r; if (x.kind === "square") return x.s; if (x.kind === "tri") return x.a; if (x.kind === "line") return x.l; if (x.kind === "dot") return x.d; return "none:" + x.kind; }
let noted = 0; function note(): void { noted++; }
function rowWithCalls(x: Shape): unknown { if (x.kind === "circle") return x.r; note(); if (x.kind === "square") return x.s; note(); if (x.kind === "tri") return x.a; note(); if (x.kind === "line") return x.l; note(); if (x.kind === "dot") return x.d; return "none:" + x.kind + noted; }
function elseIfs(x: Shape): unknown { let out: unknown; if (x.kind === "dot") out = x.d; else if (x.kind === "line") out = x.l; else if (x.kind === "tri") out = x.a; else if (x.kind === "none") out = "n"; else out = "rest:" + x.kind + (x as any).r + (x as any).s; return out; }
function oneOf(x: Shape): unknown { if (x.kind === "tri" || x.kind === "line" || x.kind === "dot") return "thin:" + x.kind + (x as any).a + (x as any).l + (x as any).d; return "wide:" + x.kind; }
function cases(x: Shape): unknown { switch (x.kind) { case "circle": return "c" + x.r; case "tri": case "line": return "t" + (x as any).a + (x as any).l; case "dot": return "d" + x.d; case "square": return "s" + x.s; case "none": return "n"; default: return "other:" + (x as any).kind; } }
function all(x: unknown): string { return show(() => area(x as Shape)) + "," + show(() => name(x as Shape)) + "," + show(() => not(x as Shape)) + "," + show(() => row(x as Shape)) + "," + show(() => rowWithCalls(x as Shape)) + "," + show(() => elseIfs(x as Shape)) + "," + show(() => oneOf(x as Shape)) + "," + show(() => cases(x as Shape)); }
const circle = (): Shape => ({ kind: "circle", r: 2 });
const square = (): Shape => ({ kind: "square", s: 3 });
const none = (): Shape => ({ kind: "none" });
function* steps(x: Shape) { if (x.kind === "circle") { yield 1; yield x.r; } else yield "other"; } async function later(x: Shape) { if (x.kind === "square") { await null; return x.s; } return "other"; } const late: unknown[] = []; function deed(): unknown[] { const c: any = circle(); const it = steps(c); it.next(); c.kind = "square"; delete c.r; const s: any = square(); later(s).then(v => late.push(v)); s.kind = "none"; s.s = "changed"; return [String(it.next().value), late.join()]; }
const tri = (): Shape => ({ kind: "tri", a: 4 });
const line = (): Shape => ({ kind: "line", l: 5 });
const dot = (): Shape => ({ kind: "dot", d: 6 });
for (let round = 0; round < 3; round++) console.log(all(circle()), all(square()), all(none()), all(tri()), all(line()), all(dot()), deed().map(all).join(" "));
