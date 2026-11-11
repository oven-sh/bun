// The type is written over `await body.json()`. The rows are records, whether the bytes of the body are ASCII or not.
// COUNTER: ObjectsParsedIntoRecords >= 384
// COUNTER: ObjectsParsedIntoOrdinaryObjects <= 0
interface Row {
  id: number;
  name: string;
  score: number;
}

function textOf(prefix: string): string {
  return "[" + Array.from({ length: 64 }, (_, i) => `{"id":${i},"name":"${prefix}${i}","score":${i * 0.5}}`).join() + "]";
}

function sum(rows: Row[]): string {
  let total = 0;
  for (const row of rows) total += row.id + row.score + row.name.length;
  return total + " " + Object.keys(rows[3]!).join();
}

async function ofResponse(bytes: ArrayBuffer): Promise<string> {
  return sum((await new Response(bytes).json()) as Row[]);
}

async function ofRequest(bytes: ArrayBuffer): Promise<string> {
  const rows: Row[] = await new Request("http://localhost/", { method: "POST", body: bytes }).json();
  return sum(rows);
}

async function ofBlob(bytes: ArrayBuffer): Promise<string> {
  return sum((await new Blob([bytes]).json()) as Row[]);
}

for (const prefix of ["n", "é"]) {
  const bytes = new TextEncoder().encode(textOf(prefix)).buffer as ArrayBuffer;
  console.log(await ofResponse(bytes), await ofRequest(bytes), await ofBlob(bytes));
}
