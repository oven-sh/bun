// STATISTIC: LoopsWhoseOtherCopyAsksCountersAlone >= 1
const rounds = +process.argv[2]! || 3;
function down(a: any): any { const n = a.length; const r: any[] = []; for (let i = n - 1; i >= 0; --i) r[i] = a[i] * 2; return r; }
function short(a: any, r: any): any { for (let i = a.length - 1; i >= 0; --i) r[i] = a[i] + 1; return r; }
const lists: any[] = JSON.parse('[[0.5,1.5,2.5,3.5],[],[7],[1,2,3,4,5,6,7,8]]');
for (let r = 0; r < rounds; r++) {
  for (const list of lists) {
    console.log(down(list).join(), down(list).length);
    console.log(short(list, [9]).join(), short(list, new Array(2)).join(), short(list, JSON.parse("[0.25,0.75,1.25,1.75,2.25]")).join());
  }
}
