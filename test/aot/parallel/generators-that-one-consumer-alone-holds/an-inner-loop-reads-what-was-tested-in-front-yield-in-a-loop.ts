class Item { skip: boolean; weight: number; constructor(skip: boolean, weight: number) { this.skip = skip; this.weight = weight; } }
function* pick(flag: boolean): Generator<number> { for (let k = 0; k < (flag ? 3 : 1); k++) yield k; yield 9; }
function drive(list: Item[], at: number, times: number, flag: boolean): number { let sum = 0; const item = list[at]; if (item.skip) return -1; const first = item.weight; if (first > 90) return -2; for (const x of pick(flag)) { for (let i = 0; i < times; i++) sum = (sum + item.weight) | 0; sum = (sum + x) | 0; } return sum; }
const items: Item[] = [new Item(false, 2), JSON.parse('{"skip":false,"weight":3}'), new Item(false, 5)];
let last = ""; for (let round = 0; round < 300; round++) { last = ""; for (const flag of [false, true]) for (let at = 0; at < 3; at++) last += drive(items, at, 3, flag) + " "; } console.log(last);
