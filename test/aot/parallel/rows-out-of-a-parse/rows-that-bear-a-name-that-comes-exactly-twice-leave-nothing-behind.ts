// COUNTER: MostRecordPlansHeld = 1
// COUNTER: ObjectsParsedIntoRecords >= 320000
import { heapStats } from "bun:jsc";
interface Row { id: number; name: string; email: string; active: boolean; score: number }
const chunk = 10000;
function parseAndDrop(rows: number, from: number): number {
  let kept: Row[][] = [], s = 0;
  for (let c = 0; c < rows / chunk; c++)
    kept.push(JSON.parse("[" + Array.from({ length: chunk }, (_, i) => { const k = (from + c * chunk + i) >> 1; return '{"id":' + k + ',"name":"n","email":"e","active":true,"score":1.5,"u' + k.toString(36) + 'q":1}'; }).join() + "]"));
  for (const list of kept) for (const r of list) s += r.id + r.score;
  kept = [];
  return s;
}
const behind = (): number => { Bun.gc(true); Bun.gc(true); return heapStats().objectCount; };
const first = parseAndDrop(20000, 0), few = behind();
const second = parseAndDrop(300000, 20000), many = behind();
console.log(first, second, many - few < 100000);
