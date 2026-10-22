// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number }
const make = (): any => { const reading: Reading = { level: 1 }; return reading; };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); } }
attempt("delete", () => delete make().level);
attempt("getter", () => Object.defineProperty(make(), "level", { get() { return 7; } }).level);
