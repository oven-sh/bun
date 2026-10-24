// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Point { x: number; y: number }
const make = (): any => { const point: Point = { x: 1, y: 2 }; return point; };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); } }
attempt("delete of a fresh one", () => delete make().x);
attempt("store into a fresh one", () => { make().x = "text"; return "done"; });
