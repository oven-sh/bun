// A record that holds itself three ways, three times in a list: the getter on the way runs once.
const log: string[] = [];
interface Ring { size: number; below: Ring[] }
const straight: Ring = { size: 0, below: [] };
interface Crate { before: unknown; held: Ring; after: unknown; self: Crate | null }
const crate: Crate = { before: null, held: straight, after: null, self: null };
crate.before = { get g() { log.push("getter"); return 1; } };
crate.after = { deep: { deeper: crate } };
crate.self = crate;
for (let turn = 0; turn < 3; turn++) {
  try { console.log(JSON.stringify([crate, crate, crate])); } catch (error) { console.log((error as Error).name, log.join()); }
  log.length = 0;
}
