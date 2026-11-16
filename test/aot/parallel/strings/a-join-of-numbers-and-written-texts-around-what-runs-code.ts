const log: string[] = [];
interface Row { id: number; on: boolean; next: Row | null; label: string }
const rows: Row[] = [];
for (let i = 0; i < 8; i++) rows.push({ id: i * 3, on: (i & 1) === 1, next: i ? rows[i - 1]! : null, label: "l" + i });
const pairs = new Map<string, string>();
for (const a of rows) for (const b of rows) pairs.set(a.id + "," + b.id, a.label + b.label);

const changes = {
  row: rows[0]!,
  get bumps() { log.push("bumps"); this.row.id += 100; this.row.on = !this.row.on; return 5; },
  get throws(): number { log.push("throws"); throw new RangeError("asked"); },
  get text() { log.push("text"); this.row.id += 1000; return "t"; },
};
function bump(row: Row) { log.push("bump"); row.id += 7; return row.id; }

const shapes: Record<string, (a: Row, b: Row) => unknown> = {
  key: (a, b) => pairs.get(a.id + "," + b.id),
  getterChangesWhatWasRead: (a) => { changes.row = a; return a.id + "," + changes.bumps + "," + a.id; },
  getterOfText: (a) => { changes.row = a; return a.id + ":" + a.on + ":" + changes.text + ":" + a.id; },
  callChangesWhatWasRead: (a) => a.id + "/" + bump(a) + "/" + a.id + "/" + bump(a),
  getterThrows: (a) => { changes.row = a; return a.id + "," + changes.throws + "," + bump(a); },
  readOffNothing: (a) => a.id + "," + a.next!.id + "," + a.next!.next!.id,
  everyKind: (a, b) => a.id + "|" + a.on + "|" + null + "|" + undefined + "|" + b.next + "|" + b.id / 7 + "|" + -b.id * 0 + "|" + b.id * 1e21,
  keptOverACall: (a, b) => { const text = a.id + "-" + a.on; bump(a); return text + "-" + b.id + "-" + a.id; },
};

for (const name of Object.keys(shapes)) {
  for (const [x, y] of [[1, 2], [1, 2], [2, 1], [0, 7], [7, 0], [1, 1]] as const) {
    let said: string;
    try {
      said = String(shapes[name]!(rows[x]!, rows[y]!));
    } catch (error) {
      said = (error as Error).name;
    }
    console.log(name, x, y, said, log.splice(0).join());
  }
}
console.log(rows.map((row) => row.id + ":" + row.on).join(" "));

async function awaitsBetween(a: Row, b: Row) { return a.id + "," + (await Promise.resolve(bump(a))) + "," + a.id + "," + (await b.id) + ";" + a.on; }
function* yieldsBetween(a: Row): Generator<number, string, number> { return a.id + "," + (yield bump(a)) + "," + a.id + "," + (yield a.id) + ";" + a.on; }
function growsInLoop(list: Row[]) { let text = ""; for (const row of list) text += row.id + "," + bump(row) + "," + row.on + ";"; return text; }
function caughtBetween(a: Row) {
  let text = "none";
  try { changes.row = a; text = a.id + "," + a.on + "," + changes.throws; } catch (error) { text += "|" + (error as Error).message + "|" + a.id; }
  return text;
}
for (const [x, y] of [[3, 4], [3, 4], [4, 3]] as const) {
  console.log(await awaitsBetween(rows[x]!, rows[y]!), log.splice(0).join());
  const steps = yieldsBetween(rows[x]!);
  console.log(steps.next().value, steps.next(-1).value, steps.next(0.5).value, log.splice(0).join());
  console.log(growsInLoop(rows.slice(x, y + 2)), log.splice(0).join());
  console.log(caughtBetween(rows[y]!), log.splice(0).join());
}
