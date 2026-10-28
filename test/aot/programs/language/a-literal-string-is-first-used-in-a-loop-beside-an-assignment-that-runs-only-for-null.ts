const r3= { weight: 0 };
type S5 = { tag: any; count: any };
const r6= { tag: r3.weight, count: 7 };
const r7: S5 = r6;
+ r7;
  for (let i16 = 0; i16 < 2; i16++) {
    r6.count = "-0".slice().charCodeAt(2147483647) | 0;
    r7.count ??= i16}
class Counter22 {
  static count: any }
  Counter22.count = NaN
