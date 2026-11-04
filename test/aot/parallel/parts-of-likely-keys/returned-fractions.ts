// One deed a program: `${a.id},${b.id}` that is looked up, where id is written a number and is, at run time, what the deed says. The text of a number may be made late; what runs code or throws does so in its turn. Made by staging/parts-of-likely-keys-1/make-family-of-keys.py.
type Item = { id: number; name: string };
const said: string[] = [];
const table = new Map<string, number>();
function keyOf(a: Item, b: Item) { return `${a.id},${b.id}`; }
function look(a: Item, b: Item) { const key = keyOf(a, b); let found = table.get(key); if (found === undefined) { found = table.size; table.set(key, found); } return key + "=" + found; }

function attempt(a: any, b: any) { try { said.push(look(a, b)); } catch (e) { said.push((e as Error).constructor.name); } }
(globalThis as any).kept = look;
const all: any[] = [{ id: 1.5, name: "n" }, { id: 0.1 + 0.2, name: "n" }, { id: 1e21, name: "n" }, { id: 1e-7, name: "n" }, { id: 123456789012345680000, name: "n" }, { id: -0, name: "n" }, { id: 1.5, name: "n" }];
for (const a of all) for (const b of all) attempt(a, b);
console.log(said.join(" | "));
