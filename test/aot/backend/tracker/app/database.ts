import { SQL } from "bun";

export const sql = new SQL({
  url: process.env.DATABASE_URL ?? "postgres://tracker:tracker@127.0.0.1:5432/tracker",
  max: Number(process.env.DATABASE_POOL ?? 8),
});
