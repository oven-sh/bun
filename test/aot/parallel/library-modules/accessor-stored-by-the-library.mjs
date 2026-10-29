import { SQL } from "bun";
const sql = new SQL("sqlite://:memory:");
const query = sql`select 1 as x`;
console.log(query.active, query.cancelled);
console.log(JSON.stringify(await query), query.active);
await sql.close();
