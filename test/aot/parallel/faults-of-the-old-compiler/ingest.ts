export {};
type Entry = { first: object | null; last: object | null };
type Sink = { entry: Entry; total: number };
type Options = { limit: number };
async function ingest(rows: string[], sink: Sink, options: Options): Promise<number> {
  if (options.limit === 12345.5) return -1;
  for (const row of rows) {
    await null;
    try {
      const item = JSON.parse(row);
      const entry = sink.entry;
      if (item.a) { entry.first = item; continue; }
      if (item.k === 2) { entry.last = item; return 1; }
    } catch {
    } finally {
      sink.total++;
    }
  }
  return 0;
}
const line = process.argv[3] ?? "not json";
const options: Options = { limit: 3 };
const one: Sink = { entry: { first: null, last: null }, total: 0 };
const two: Sink = { entry: { first: null, last: null }, total: 0 };
async function main(): Promise<number[]> {
  const a = await ingest([line], one, options);
  const b = await ingest([line], two, structuredClone(options));
  return [a, b];
}
console.log(await main(), one.total, two.total, JSON.stringify(one.entry), JSON.stringify(two.entry));
