// The program makes no row itself: rows out of a text become objects of a class.
interface Row { id: number; name: string; active: boolean }
let text = "["; for (let i = 0; i < 40; i++) text += (i ? "," : "") + '{"id":' + i + ',"name":"n' + i + '","active":' + (i % 3 !== 0) + "}"; text += "]";
const rows: Row[] = JSON.parse(text);
class User { id: number; name: string; active: boolean; constructor(row: Row) { this.id = row.id; this.name = row.name; this.active = row.active; } label(): string { return this.name + "#" + this.id; } }
let out = 0; for (let t = 0; t < 50; t++) for (const user of rows.map(row => new User(row))) if (user.active) out += user.label().length + user.id;
console.log(out);
