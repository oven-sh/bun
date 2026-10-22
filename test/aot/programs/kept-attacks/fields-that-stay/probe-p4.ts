// Fields that stay, one probe of many. It prints what plain Bun prints.
class Gauge { level: number = 1 }
interface Reading { level: number }
const make = (): any => { const reading: Reading = { level: 1 }; return reading; };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); } }
attempt("delete", () => delete make().level);
attempt("class delete", () => delete (new Gauge() as any).level);
