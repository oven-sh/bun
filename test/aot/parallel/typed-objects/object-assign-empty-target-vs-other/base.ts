export type Rec = { a: number; b: number; n: { v: number }; bump?: () => void };
const records: Rec[] = [{ a: 1, b: 2, n: { v: 3 } }, { a: 4, b: 5, n: { v: 6 } }];
export function remembered(a: number): Rec { return records[a % 2]!; }
let offset = 1;
export const B3 = remembered(5);
export const D3_0 = Object.assign({}, B3, { z: offset });
