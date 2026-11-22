import { nextTurns } from "../host.ts";
let kept: unknown;
const view = new DataView(new ArrayBuffer(64));
const values: number[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]");
function store(target: DataView, numbers: number[], from: number, to: number): void {
  for (let i = from; i < to; i++) target.setFloat64((i & 7) * 8, numbers[i & 7]);
}
function bench(n: number): number {
  store(view, values, 1, n + 1);
  kept = view;
  return view.getFloat64(8) | 0;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
