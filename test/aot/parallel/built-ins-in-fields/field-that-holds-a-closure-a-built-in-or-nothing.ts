// The type lets the field be left out, and a call of nothing throws.
type Table = { handler?: (x: number) => number };
function call(table: Table, x: number): string {
  try { return String(table.handler!(x)); } catch (error) { return (error as Error).constructor.name; }
}
function main() {
  const tables: Table[] = [{ handler: x => x + 3 }, { handler: Math.abs }, {}, { handler: undefined }];
  const said: string[] = [];
  for (let i = 0; i < 400; i++) said.push(call(tables[i & 3], -i));
  console.log(said.slice(0, 8).join(), said.slice(-4).join());
}
main();
