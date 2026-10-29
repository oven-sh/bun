import { SQL } from "bun";
import { createServer } from "node:net";

const server = createServer();
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
await new Promise(resolve => server.close(resolve));

for (const url of [
  `postgres://user:password@127.0.0.1:${port}/database`,
  `mysql://user:password@127.0.0.1:${port}/database`,
]) {
  const sql = new SQL(url, { max: 1 });
  try {
    await sql`select 1`;
    console.log("connected");
  } catch (error: any) {
    const adapterError = url.startsWith("mysql") ? SQL.MySQLError : SQL.PostgresError;
    console.log(
      error.name,
      error.code,
      error instanceof adapterError,
      error instanceof SQL.SQLError,
      error instanceof Error,
    );
  }
  await sql.close();
}
