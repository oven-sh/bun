// Fields that stay, one probe of many. It prints what plain Bun prints.
interface Reading { level: number }
const make = (): any => { const reading: Reading = { level: 1 }; return reading; };
function attempt(label: string, f: () => unknown) { try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); } }
const kept: any[] = [];
attempt("delete of one that escaped", () => { const o = make(); kept.push(o); return delete kept[kept.length - 1].level; });
attempt("delete under a computed key", () => { const o = make(); kept.push(o); return delete kept[kept.length - 1][["le", "vel"].join("")]; });
attempt("Reflect", () => { const o = make(); kept.push(o); return Reflect.deleteProperty(kept[kept.length - 1], "level"); });
attempt("delete of a fresh one", () => delete make().level);
console.log(JSON.stringify(kept));
