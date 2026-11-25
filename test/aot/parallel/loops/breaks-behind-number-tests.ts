const table0: any = Array.from([0.5, -1, 0.5, 7, 0.5, 4]);
let sum: number = 0;
const state: any = { count: 2, last: 1, more: "m" };
function show(value: any): any {
  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + Array.prototype.map.call(value, show).join() + "]" : String(value);
}
function compute0(a: number, b: number, given: any): any {
  let v0: any = 0;
  let v1: number = a | 0;
  let v2: any = a | 0;
  let i3: number = 2;
  while (i3-- >= 0) {
    table0[v2 & 1] = (1 ^ 1);
    if ((+sum) !== (v2 >>> 0)) break;
  }
  return [v0, v1, v2];
}
console.log(show(compute0(5, 2, JSON.parse("[-1, 0.5, 2, 7, 0]"))));
console.log(show(compute0(5, JSON.parse("3"), [3, 1, 2])));
console.log(show(compute0(33, JSON.parse("3"), [3, 1, 2])));
console.log(show(sum), show(state.count), show(state.last), show(table0));
export {};

