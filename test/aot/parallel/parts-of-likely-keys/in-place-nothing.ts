// One deed a program: `${a.id},${b.id}` that is looked up, where id is written a number and is, at run time, what the deed says. The text of a number may be made late; what runs code or throws does so in its turn. Made by staging/parts-of-likely-keys-1/make-family-of-keys.py.
type Item = { id: number; name: string };
const said: string[] = [];
const table = new Map<string, number>();
function look(a: Item, b: Item) { let found = table.get(`${a.id},${b.id}`); if (found === undefined) { found = table.size; table.set(`${a.id},${b.id}`, found); } return found + ":" + [...table.keys()].pop(); }

function attempt(a: any, b: any) { try { said.push(look(a, b)); } catch (e) { said.push((e as Error).constructor.name); } }
(globalThis as any).kept = look;
const all: any[] = [{ id: undefined, name: "n" }, { id: null, name: "n" }, { id: undefined, name: "n" }];
for (const a of all) for (const b of all) attempt(a, b);
console.log(said.join(" | "));
