// CLIFF: C151
type Row = { id: number; note?: string };

function createKept(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) rows.push({ id: i, note: "kept" });
  return rows;
}

function createTrimmed(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) rows.push({ id: i, note: "trimmed" });
  return rows;
}

function sumKept(rows: Row[]): number {
  let sum = 0;
  for (const row of rows) sum += row.id + (row.note?.length ?? 0);
  return sum;
}

function sumTrimmed(rows: Row[]): number {
  let sum = 0;
  for (const row of rows) sum += row.id + (row.note?.length ?? 0); // touched
  return sum;
}

const kept = createKept(100);
const trimmed = createTrimmed(100);
delete trimmed[0]!.note; // trigger
console.log(sumKept(kept), sumTrimmed(trimmed));
