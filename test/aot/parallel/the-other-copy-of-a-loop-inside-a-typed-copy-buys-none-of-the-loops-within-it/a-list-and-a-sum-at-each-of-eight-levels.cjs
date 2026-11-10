// STATISTIC: LoopsBuiltTwice <= 120
// STATISTIC: WalksOfLoops <= 9000
// Both copies of a loop built twice held the loops within built twice again: 1,409 loops built twice and 29,884 walks at eight levels, 2.4 MB of code.
"use strict";
const given = JSON.parse("[1,2,3]");
function deep(turns, list0, list1, list2, list3, list4, list5, list6, list7) {
  let sum0 = 0;
  for (let i0 = 0; i0 < turns; i0++) {
    sum0 = sum0 + list0[i0] * 0.5;
    let sum1 = 0;
    for (let i1 = 0; i1 < turns; i1++) {
      sum1 = sum1 + list1[i1] * 0.5;
      let sum2 = 0;
      for (let i2 = 0; i2 < turns; i2++) {
        sum2 = sum2 + list2[i2] * 0.5;
        let sum3 = 0;
        for (let i3 = 0; i3 < turns; i3++) {
          sum3 = sum3 + list3[i3] * 0.5;
          let sum4 = 0;
          for (let i4 = 0; i4 < turns; i4++) {
            sum4 = sum4 + list4[i4] * 0.5;
            let sum5 = 0;
            for (let i5 = 0; i5 < turns; i5++) {
              sum5 = sum5 + list5[i5] * 0.5;
              let sum6 = 0;
              for (let i6 = 0; i6 < turns; i6++) {
                sum6 = sum6 + list6[i6] * 0.5;
                let sum7 = 0;
                for (let i7 = 0; i7 < turns; i7++) {
                  sum7 = sum7 + list7[i7] * 0.5;
                }
                sum6 = sum6 + sum7;
              }
              sum5 = sum5 + sum6;
            }
            sum4 = sum4 + sum5;
          }
          sum3 = sum3 + sum4;
        }
        sum2 = sum2 + sum3;
      }
      sum1 = sum1 + sum2;
    }
    sum0 = sum0 + sum1;
  }
  return sum0;
}
globalThis.kept = deep;
console.log(deep(2, given, given, given, given, given, given, given, given));
