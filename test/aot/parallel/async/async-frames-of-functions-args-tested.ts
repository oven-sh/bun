// The tests of the arguments of an async function stand in a function of their own in front of the typed body. That function waits for the body, and it is no frame of the program:
// each async function shows once in the frames of an error that native code creates, whatever the limit.
import { promises } from "node:fs";
const missing = "/nonexistent-path/does-not-exist.txt";
type Source = "node:fs" | "Bun.file";
async function innermost(source: Source): Promise<unknown> {
  if (source === "node:fs") return await promises.readFile(missing);
  return await Bun.file(missing).text();
}
async function middle(source: Source): Promise<unknown> {
  const result = await innermost(source);
  return result;
}
async function outermost(source: Source): Promise<unknown> {
  return await middle(source);
}
async function rejection(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return "fulfilled"; } catch (error) { return JSON.stringify(((error as Error).stack ?? "").split("\n").slice(1).map(line => line.trim().replace(/\(.*[\\\/]/, "("))); }
}
async function main(): Promise<void> {
  for (const source of ["node:fs", "Bun.file"] as const) {
    for (const limit of [1, 2, 3, 4, 5, 10]) {
      Error.stackTraceLimit = limit;
      console.log(source, limit, await rejection(() => outermost(source)));
    }
  }
}
main();
