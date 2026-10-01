// Prints the member names and method names that the keyword rule renames.
import { allDefs } from "./model.ts";
import { snake, field } from "./names.ts";
const seen = new Map<string, Set<string>>();
for (const d of allDefs()) for (const f of [...d.slots, ...d.lates]) if (snake(f.goName) !== field(f.goName)) { const s = seen.get(f.goName) ?? new Set(); s.add(d.name); seen.set(f.goName, s); }
for (const [name, defs] of seen) console.log(`${name} -> ${field(name)} (${defs.size} definitions)`);
