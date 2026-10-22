interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
type Kind = "circle" | "square";
function sides(kind: Kind): number { switch (kind) { case "circle": return 0; case "square": return 4; } }
function named(kind: Kind): string { return kind === "circle" ? "round" : kind === "square" ? "angular" : "neither " + kind; }
function upper(kind: Kind): string { return kind.toUpperCase(); }
for (const kind of ["circle", null, "square", undefined]) { attempt("sides", () => sides(kind as any)); attempt("named", () => named(kind as any)); attempt("upper", () => upper(kind as any)); }
