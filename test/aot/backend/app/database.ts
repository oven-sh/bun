import { SQL } from "bun";

export const sql = new SQL({
  url: process.env.DATABASE_URL ?? "postgres://benchmarkdbuser:benchmarkdbpass@127.0.0.1:5432/hello_world",
  max: Number(process.env.DATABASE_POOL ?? 8),
});

export interface World {
  id: number;
  randomNumber: number;
}

export interface Fortune {
  id: number;
  message: string;
}

export async function findWorld(id: number): Promise<World> {
  const [world] = await sql<World[]>`SELECT id, randomnumber AS "randomNumber" FROM world WHERE id = ${id}`;
  if (!world) throw new Error(`There is no world ${id}`);
  return world;
}

export async function saveWorlds(worlds: World[]): Promise<void> {
  const ordered = worlds.toSorted((a, b) => a.id - b.id);
  const ids = sql.array(
    ordered.map(world => world.id),
    "INT4",
  );
  const randomNumbers = sql.array(
    ordered.map(world => world.randomNumber),
    "INT4",
  );
  await sql`
    UPDATE world SET randomnumber = changed.randomnumber
    FROM unnest(${ids}, ${randomNumbers}) AS changed (id, randomnumber)
    WHERE world.id = changed.id`;
}

export async function allFortunes(): Promise<Fortune[]> {
  return await sql<Fortune[]>`SELECT id, message FROM fortune`;
}
