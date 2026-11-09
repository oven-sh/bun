// One deed a program: `${a.id},${b.id}` that is looked up, where id is written a number and is, at run time, what the deed says. The text of a number may be made late; what runs code or throws does so in its turn.
type Item = { id: number; name: string };
const said: string[] = [];
const table = new Map<string, number>();
function look(a: Item, b: Item) { let found = table.get(`${a.id},${b.id}`); if (found === undefined) { found = table.size; table.set(`${a.id},${b.id}`, found); } return found + ":" + [...table.keys()].pop(); }

function attempt(a: any, b: any) { try { said.push(look(a, b)); } catch (e) { said.push((e as Error).constructor.name); } }
(globalThis as any).kept = look;
let sum = 0; for (let i = 0; i < 40000; i++) sum += look({ id: i, name: "n" }, { id: i * 7, name: "n" }).length; said.push(String(sum) + " " + table.size);
console.log(said.join(" | "));
