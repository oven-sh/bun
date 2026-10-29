const r3 = { weight: 0 };
type S5 = { tag: any; count: any };
const r6 = { tag: r3.weight, count: 7 };
const r7: S5 = r6;
console.log(+r7, String(r7), r7 === r6);
for (let i16 = 0; i16 < 2; i16++) {
  r6.count = "-0".slice().charCodeAt(2147483647) | 0;
  r7.count ??= i16;
}
console.log(JSON.stringify(r6), JSON.stringify(r7), r6.count, r7.count);
class Counter22 { static count: any }
Counter22.count = NaN;
console.log(Counter22.count);
