import mysql from "mysql2";
import mysqlPromise from "mysql2/promise";
import type { AddressInfo } from "node:net";

const seen: string[] = [];
const server = mysql.createServer(() => {});
server.on("connection", (connection: any) => {
  connection.serverHandshake({ protocolVersion: 10, serverVersion: "8.0.0-smoke", connectionId: 1, statusFlags: 2, characterSet: 8, capabilityFlags: 0xffffff });
  connection.on("query", (text: string) => {
    seen.push(text);
    const column = (name: string, columnType: number) => ({ catalog: "def", schema: "d", table: "person", orgTable: "person", name, orgName: name, characterSet: 33, columnLength: 384, columnType, flags: 0, decimals: 0 });
    connection.writeColumns([column("id", 3), column("name", 253)]);
    connection.writeTextRow(["1", "ada"]);
    connection.writeTextRow(["2", "grace"]);
    connection.writeEof();
  });
  connection.on("error", () => {});
});
const port = await new Promise<number>(resolve => { (server as any).listen(0, "127.0.0.1", () => resolve(((server as any)._server.address() as AddressInfo).port)); });

const connection = await mysqlPromise.createConnection({ host: "127.0.0.1", port, user: "u", password: "p", database: "d" });
const [rows, fields] = await connection.query("select id, name from person");
console.log(JSON.stringify(rows), fields.map(field => field.name).join());
const [again] = await connection.query({ sql: "select id, name from person where id = ?", values: [1], rowsAsArray: true });
console.log(JSON.stringify(again));
console.log(connection.format("select ? + ?, ??", [1, "a'b", "col"]));
connection.destroy();
(server as any).close();
console.log(seen.join(" | "));
console.log("DONE");
process.exit(0);
