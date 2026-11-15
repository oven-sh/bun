class Row {
  constructor(public id: number, public head: Row | null) {}
}
function sumOf(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return sum;
}
function said(make: () => unknown): string {
  try {
    const text = JSON.stringify(make());
    return text.length + ":" + sumOf(text);
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const count: number = JSON.parse("12000");
console.log(said(() => Array.from({ length: count }, (_, id) => { const first = new Row(id, null); return [first, new Row(id + 1, first)]; })));
console.log(said(() => Array.from({ length: count }, (_, id) => { const first = new Row(id, null); return [first, new Row(id + 1, null), new Row(id + 2, first), new Row(id + 3, first)]; })));
console.log(said(() => { const rows = Array.from({ length: count }, (_, id) => new Row(id, null)); for (const row of rows) row.head = row.id ? rows[0]! : null; return rows; }));
console.log(said(() => { const pairs = Array.from({ length: count }, (_, id) => [new Row(id, null), new Row(id, null)]); pairs[count - 1]![1]!.head = pairs[count - 1]![1]!; return pairs; }));
console.log(said(() => { const pairs = Array.from({ length: count }, (_, id) => [new Row(id, null), new Row(id, null)]); pairs[count - 1]![0]!.head = pairs[count - 1]![1]!; pairs[count - 1]![1]!.head = pairs[count - 1]![0]!; return pairs; }));
