import { AsyncDatabase, Database } from "bun:sqlite";

const mode = process.argv[2];
if (mode !== "sync" && mode !== "async") {
  throw new Error("mode must be sync or async");
}

const query = `
  WITH RECURSIVE counter(value) AS (
    VALUES(1)
    UNION ALL
    SELECT value + 1 FROM counter WHERE value < ?
  )
  SELECT sum(value) AS total FROM counter
`;

const syncDatabase = mode === "sync" ? new Database(":memory:") : undefined;
const syncStatement = syncDatabase?.query(query);
const asyncDatabase = mode === "async" ? await AsyncDatabase.open(":memory:") : undefined;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/ping") {
      return Response.json({ ok: true });
    }

    if (pathname === "/slow") {
      console.log(JSON.stringify({ event: "slow-started" }));
      const startedAt = performance.now();
      const total =
        mode === "sync" ? syncStatement.get([2_000_000]).total : (await asyncDatabase.get(query, [2_000_000])).total;
      return Response.json({ total, wallMs: performance.now() - startedAt });
    }

    if (pathname === "/stop") {
      setImmediate(async () => {
        syncStatement?.finalize();
        syncDatabase?.close();
        await asyncDatabase?.close();
        await server.stop(true);
      });
      return Response.json({ stopped: true });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(JSON.stringify({ event: "ready", port: server.port }));
