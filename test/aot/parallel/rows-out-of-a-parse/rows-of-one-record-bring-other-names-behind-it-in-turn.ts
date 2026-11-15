// COUNTER: PeakRecordPlansCached = 1
// COUNTER: ObjectsParsedIntoOrdinaryObjects = 0
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
interface Row { id: number; name: string; active: boolean }
const total = (r: Row): number => r.id + r.name.length + (r.active ? 1 : 0);
const tails = ['"zqaa":1', '"zqbb":2', '"zqaa":3,"zqbb":4', '"zqbb":5,"zqaa":6', '"zqcc":"seven"', '"zqaa":8', '"zqbb":9,"zqcc":10,"zqaa":11', ''];
const text = "[" + Array.from({ length: 48 }, (_, i) => '{"id":' + i + ',"name":"n' + i + '","active":' + (i % 3 === 0) + (tails[i % 8] ? "," + tails[i % 8] : "") + "}").join() + "]";
for (let turn = 0; turn < 3; turn++) {
  const rows: Row[] = JSON.parse(text);
  let s = 0;
  for (const r of rows) s += total(r);
  console.log(turn, s, rows.slice(0, 9).map(r => Object.keys(r).join("") + ":" + JSON.stringify(r)).join(" "));
  if (turn === 1) Bun.gc(true);
}
