const printValue = console.log;
const table0_1: any = new Array(4).fill(0);
let sum_1: number = 0;
const state_1: any = { count: 3, last: 1, more: "m" };
function show_1(value: any): any {
  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "[" + Array.prototype.map.call(value, show_1).join() + "]" : String(value);
}
function compute0_1(a: any, b: number, given: any): any {
  let v0: any = a * 2;
  let v1: any = a;
  let v2: any = a;
  let i3: number = 3;
  while (i3-- >= 0) {
    let i5: number = 0;
    for (;;) {
      if (i5++ > 1) break;
      if ((0) in Object(table0_1)) v0 = (-2147483648) / 3;
      table0_1[sum_1 & 3] = 2 ** 32 * 2;
      let i6: number = 0;
      for (;;) {
        if (i6++ > 1) break;
        v0 = given[v0];
        v2 = (Math.sqrt(b) & b + sum_1);
      }
    }
  }
  for (let i9 = -1; i9 < 4; i9 += 2) {
    if ((+a) !== (v1 >> a)) {
      v1++;
    } else {
      v0 = v0 - 4294967295;
    }
    let i10: number = 0;
    for (;;) {
      if (i10++ > 3) break;
      sum_1 = table0_1[+a % +v2];
    }
    let i11: number = 0;
    while (i11 < 2) {
      table0_1[0] = Math.hypot(-0, 0);
      state_1.last = Math.hypot(((v2 % 2) in Object(given) ? v2 : i11), (2 << 1));
      v2 = Math.sign((v2) % 3);
      i11 += 0.5;
    }
  }
  return [v0, v1, v2];
}
printValue(show_1(compute0_1(2147483648, JSON.parse("3"), new Float64Array([4, 2.5]))));
printValue(show_1(sum_1), show_1(state_1.count), show_1(state_1.last), show_1(table0_1));
export {};
