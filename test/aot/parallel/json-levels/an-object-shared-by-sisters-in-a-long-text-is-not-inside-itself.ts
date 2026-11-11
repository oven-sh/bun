type Owner = { id: number; tags: string[] };
type Row = { id: number; tags: string[]; owner: Owner; notes: { tags: string[] }[] };
function sumOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return sum;
}
function rowsThatShare(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const tags = ["a" + (i % 7), "b"];
    rows.push({ id: i, tags, owner: { id: i + 1, tags }, notes: [{ tags }, { tags }] });
  }
  return rows;
}
const shared = JSON.stringify(rowsThatShare(6000));
console.log(shared.length, sumOf(shared));
const oneForAll = { id: 0, tags: ["x"] };
const many = JSON.stringify(Array.from({ length: 9000 }, (_, i) => ({ id: i, first: oneForAll, second: oneForAll, deep: { owner: oneForAll, list: [oneForAll, oneForAll] } })));
console.log(many.length, sumOf(many));
function refuses(make: (rows: Row[]) => unknown): string {
  const rows = rowsThatShare(6000);
  try {
    return String(JSON.stringify(make(rows))?.length);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
console.log(refuses(rows => { (rows[5990]!.owner as any).self = rows[5990]!.owner; return rows; }));
console.log(refuses(rows => { (rows[5990]!.owner as any).row = rows[5990]; return rows; }));
console.log(refuses(rows => { (rows[5990]!.notes[1] as any).up = rows[5990]!.notes; return rows; }));
console.log(refuses(rows => { (rows[10]!.owner as any).later = rows[5990]; return rows; }));
