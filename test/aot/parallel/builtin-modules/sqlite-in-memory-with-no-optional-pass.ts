import { SQL } from "bun";

const database = new SQL("sqlite://:memory:");
const rows = await database`select 1 as x, 'two' as y`;
console.log(rows.length, rows[0].x, rows[0].y);
await database.close();
