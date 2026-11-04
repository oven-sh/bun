type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number } | { kind: "none" };
function area(x: Shape): unknown { if (x.kind === "circle") return x.r * 3; if (x.kind === "square") return x.s * x.s; return "none:" + x.kind; }
function name(x: Shape): unknown { switch (x.kind) { case "circle": return "c" + x.r; case "square": return "s" + x.s; default: return "n" + (x as any).r + (x as any).s; } }
function not(x: Shape): unknown { return x.kind !== "circle" ? (x.kind !== "square" ? "n" : x.s) : x.r; }
function show(run: () => unknown): string { try { return String(run()); } catch (error) { return (error as Error).constructor.name; } }
function all(x: unknown): string { return show(() => area(x as Shape)) + "," + show(() => name(x as Shape)) + "," + show(() => not(x as Shape)); }
const circle = (): Shape => ({ kind: "circle", r: 2 });
const square = (): Shape => ({ kind: "square", s: 3 });
const none = (): Shape => ({ kind: "none" });
function* steps(x: Shape) { if (x.kind === "circle") { yield 1; yield x.r; } else yield "other"; } async function later(x: Shape) { if (x.kind === "square") { await null; return x.s; } return "other"; } const late: unknown[] = []; function deed(): unknown[] { const c: any = circle(); const it = steps(c); it.next(); c.kind = "square"; delete c.r; const s: any = square(); later(s).then(v => late.push(v)); s.kind = "none"; s.s = "changed"; return [String(it.next().value), late.join()]; }
for (let round = 0; round < 3; round++) console.log(all(circle()), all(square()), all(none()), deed().map(all).join(" "));
