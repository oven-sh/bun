// COUNTER: ObjectsParsedIntoOrdinaryObjects = 0
// COUNTER: ObjectsParsedIntoRecords = 180
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
interface Row { id: number; name: string; active: boolean }
const total = (r: Row): number => { try { return r.id + r.name.length + (r.active ? 1 : 0); } catch { return 1000; } };
const text = (odd: string): string => "[" + Array.from({ length: 60 }, (_, i) => "{" + (i === 20 ? odd : '"id":' + i + ',"name":"n' + i + '","active":' + (i % 3 === 0)) + ',"zqone":' + i + "}").join() + "]";
for (const odd of ['"id":"x","name":"n","active":true', '"id":1,"name":null,"active":true', '"id":1,"name":"n","active":"yes"']) {
  const rows: Row[] = JSON.parse(text(odd));
  let s: number | string = 0;
  for (const r of rows) s += total(r) as any;
  console.log(s, JSON.stringify(rows[19]), JSON.stringify(rows[20]), JSON.stringify(rows[21]), Object.keys(rows[59]!).join());
}
