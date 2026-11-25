// One deed a program: `${a.id},${b.id}` that is looked up, where id is written a number and is, at run time, what the deed says. The text of a number may be made late; what runs code or throws does so in its turn.
type Item = { id: number; name: string };
const said: string[] = [];
const table = new Map<string, number>();
function keyOf(a: Item, b: Item) { return `${a.id},${b.id}`; }
function look(a: Item, b: Item) { const key = keyOf(a, b); let found = table.get(key); if (found === undefined) { found = table.size; table.set(key, found); } return key + "=" + found; }

function attempt(a: any, b: any) { try { said.push(look(a, b)); } catch (e) { said.push((e as Error).constructor.name); } }
(globalThis as any).kept = look;
attempt({ id: { [Symbol.toPrimitive](hint: string) { said.push(hint); return 7; } }, name: "n" }, { id: 2, name: "n" });
console.log(said.join(" | "));
