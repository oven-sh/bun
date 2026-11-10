// COUNTER: RecordPlanChoices <= 3
// COUNTER: ObjectsParsedIntoRecords = 2
// COUNTER: ObjectsParsedIntoOrdinaryObjects = 20000
interface Row { id: number; name: string; active: boolean }
interface Stamp { stampedAt: number }
const row: Row[] = JSON.parse('[{"id":1,"name":"ab","active":true}]'), stamp: Stamp[] = JSON.parse('[{"stampedAt":3}]');
const rows: (Row & Stamp)[] = JSON.parse("[" + Array.from({ length: 20000 }, (_, i) => '{"id":' + i + ',"stampedAt":' + i + ',"zn' + i.toString(36) + 'q":0}').join() + "]") as any;
let s = row[0]!.id + stamp[0]!.stampedAt;
for (const r of rows) s += r.id + r.stampedAt;
console.log(s, Object.keys(rows[19999]!).join());
