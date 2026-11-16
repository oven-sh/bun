import type { int32 } from "bun";
interface Holder { level: 1 | 2 | 3 }
function negated(holder: Holder): int32 { return -holder.level; }
const holders: Holder[] = JSON.parse('[{"level":1},{"level":3},{"level":2}]');
const here: Holder[] = [{ level: 2 }, { level: 1 }];
function total(list: Holder[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += negated(list[i]!); return sum; }
console.log(total(holders), total(here));
