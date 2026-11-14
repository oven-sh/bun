// A field that holds an object may be absent: records of one layout have fewer or more keys. Each is written again.
interface Place { x: number; y: string; }
interface Row { at?: Place; id: number; next?: Place; }
const made: Row[] = [{ at: { x: 1, y: "a" }, id: 1, next: { x: 2, y: "b" } }, { id: 2 }];
function written(i: number): string {
  const at = '"at":{"x":' + (i % 3) + ',"y":"place"}', id = '"id":' + (i % 2), next = '"next":{"x":7,"y":"next place"}';
  switch (i % 5) {
    case 0: return "{" + id + "}";
    case 1: return "{" + at + "," + id + "}";
    case 2: return "{" + id + "," + next + "}";
    case 3: return "{" + at + "," + id + "," + next + "}";
    default: return "{" + next + "," + id + "}";
  }
}
let sum = made.length;
for (let turn = 0; turn < 40; turn++) {
  const texts: string[] = [];
  for (let i = 0; i < 90; i++) texts.push('{"row":' + written((i * (turn + 1)) % 30) + ',"tag":"a text of more than sixteen characters"}');
  const source = "[" + texts.join() + "]";
  const rows: { row: Row; tag: string }[] = JSON.parse(source);
  if (JSON.stringify(rows) !== source) console.log("differs", turn);
  for (let i = 0; i < 90; i += 4) { const { row } = rows[i]!; row.id += 100; if (row.at) row.at.x += 1000; if (row.next) row.next.y = "changed"; }
  let others = 0;
  for (let i = 0; i < 90; i++) if (i % 4 && JSON.stringify(rows[i]) !== texts[i]) others++;
  for (const { row } of rows) sum += row.id + (row.at ? row.at.x + row.at.y.length : 1) + (row.next ? row.next.x : 2);
  console.log(others, sum);
}
