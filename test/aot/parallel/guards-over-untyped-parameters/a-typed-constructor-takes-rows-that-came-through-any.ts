interface Row { id: number; name: string; on: boolean }
const data: any = JSON.parse('{"rows":[{"id":1,"name":"a","on":true},{"id":2,"name":"b","on":false}]}');
const rows: Row[] = data.rows;
class User { id: number; name: string; on: boolean; constructor(row: Row) { this.id = row.id; this.name = row.name; this.on = row.on; } }
function all(): string { const out: unknown[] = []; for (let i = 0; i < rows.length; i++) { const u = new User(rows[i]!); out.push(u.id, u.name, u.on); } return out.join(); }
for (let t = 0; t < 300; t++) all();
console.log(all());
const copy = new User(new User(rows[1]!));
console.log(copy.id, copy.name, copy.on, copy instanceof User);
