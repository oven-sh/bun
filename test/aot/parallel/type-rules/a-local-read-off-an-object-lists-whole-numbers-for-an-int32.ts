// A local that takes its value from a member, an element or a step of a loop is an int32 where its type lists whole numbers. Nothing is proven of the object: the rows come out of `any`, and some hold what the type does not list.
import type { int32 } from "bun";
interface Holder { level: 1 | 2 | 3 }
interface Point { x: int32; y: int32 }
function inHead({ level }: Holder): int32 { return -level; }
function inBody(holder: Holder): int32 { const { level } = holder; return level + 1; }
function plain(holder: Holder): int32 { const level = holder.level; return -level; }
function element(pair: [1 | 2 | 3, string]): int32 { const [level] = pair; return -level; }
function given({ level = 2 }: { level?: 1 | 2 | 3 }): int32 { return -level; }
function steps(holders: Holder[]): int32 { let n: int32 = 0; for (const { level } of holders) n = level + 1; return n; }
function whole({ x, y }: Point): int32 { return Math.max(x, y); }
const rows: any[] = JSON.parse('[{"level":1},{"level":3},{"level":2},{"level":0},{"level":7},{"level":2.5},{"level":"7"},{}]');
for (let k = 0; k < 3; k++) for (const row of rows) console.log(inHead(row), 1 / inHead(row), inBody(row), plain(row), element([row.level, "a"]), given(row), steps([row, row]), whole({ x: 1, y: 2 }));
