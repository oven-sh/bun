// STATISTIC: LoopsWhoseOtherCopyAsksCountersAlone >= 1
const rounds = +process.argv[2]! || 3;
function sum(a: any, d: any): any { const n = a.length + d; let s = 0, c = 0; for (let i = n - 1; i >= 0; --i) { const x = a[i]; if (x > 1) { s += x; c++; } } return s + ":" + c; }
const lists: any[] = JSON.parse('[[0.5,1.5,2.5,3.5,4.5,5.5],[0.5,1.5,2.5,3.5,null,5.5],[0.5,"x",2.5,3.5,4.5,5.5],[2,3,4,5],[],[7]]');
lists[1][4] = undefined;
delete lists[3][2];
const ends: any[] = JSON.parse("[0,3,-2,0.5]");
for (let r = 0; r < rounds; r++) {
  for (const list of lists)
    console.log(ends.map(end => sum(list, end)).join(" "));
}
