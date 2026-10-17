// Bun.sql queries against a stand-in Postgres server in a child process
import { SQL } from "bun";
import { serve } from "./server";

interface World {
  id: number;
  randomnumber: number;
}

async function oneAtATime(sql: SQL, turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const rows = await sql<World[]>`SELECT id, randomnumber FROM world WHERE id = ${turn}`;
    total += rows[0]!.randomnumber;
  }
  return total;
}

async function fiveAtOnce(sql: SQL, turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const queries: Promise<World[]>[] = [];
    for (let id = 0; id < 5; id++) queries.push(sql<World[]>`SELECT id, randomnumber FROM world WHERE id = ${id}`);
    for (const rows of await Promise.all(queries)) total += rows[0]!.randomnumber;
  }
  return total;
}

async function withoutParameters(sql: SQL, turns: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += (await sql<World[]>`SELECT id, randomnumber FROM world`)[0]!.id;
  return total;
}

const cases: Record<string, (sql: SQL, turns: number) => Promise<number>> = {
  "1 one query at a time": oneAtATime,
  "1 one query at a time, no parameters": withoutParameters,
  "2 five queries at once": fiveAtOnce,
};

const name = process.argv[2]!;
if (name === "names") console.log(Object.keys(cases).join("\n"));
else if (name === "serve") serve();
else {
  const child = Bun.spawn({ cmd: [process.execPath, ...(process.argv[1]!.endsWith(".ts") ? [process.argv[1]!] : []), "serve"], stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const port = Number(new TextDecoder().decode((await reader.read()).value));
  const sql = new SQL({ url: `postgres://user@127.0.0.1:${port}/database`, max: Number(process.env.POOL ?? 4) });
  let last = 0;
  for (const turns of process.argv.slice(3)) {
    last = await cases[name]!(sql, Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
  await sql.close();
  child.kill();
}
