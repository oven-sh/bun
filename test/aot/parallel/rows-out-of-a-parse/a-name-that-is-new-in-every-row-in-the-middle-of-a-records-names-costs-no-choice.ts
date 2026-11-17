// COUNTER: RecordPlanChoices <= 1
// COUNTER: ObjectsParsedIntoRecords = 1
// COUNTER: ObjectsParsedIntoOrdinaryObjects = 20000
interface Row { id: number; name: string; active: boolean }
const fits: Row[] = JSON.parse('[{"id":1,"name":"ab","active":true}]');
const rows: Row[] = JSON.parse("[" + Array.from({ length: 20000 }, (_, i) => '{"id":' + i + ',"zm' + i.toString(36) + 'q":0,"name":"n","active":true}').join() + "]");
let s = fits[0]!.id;
for (const r of rows) s += r.id + r.name.length + (r.active ? 1 : 0);
console.log(s, Object.keys(rows[19999]!).join());
