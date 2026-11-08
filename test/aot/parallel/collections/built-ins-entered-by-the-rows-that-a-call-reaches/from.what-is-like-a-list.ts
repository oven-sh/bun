const out: string[] = [];
function tell(f: () => unknown) { try { const v = f(); return Array.isArray(v) ? "[" + v.map(x => x === undefined ? "undefined" : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)).join(",") + "]#" + v.length : String(v); } catch (e) { return "threw " + (e as Error).constructor.name + ": " + (e as Error).message; } }
function subject(items: ArrayLike<number>) { return Array.from(items); }
for (let turn = 0; turn < 4; turn++) { const items = ({ length: 3, 0: 5, 2: 1 }); out.push(tell(() => subject(items as never))); }
console.log(out.join("\n"));
