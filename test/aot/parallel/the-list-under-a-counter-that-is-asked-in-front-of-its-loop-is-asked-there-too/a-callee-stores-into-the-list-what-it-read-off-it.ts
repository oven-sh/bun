// STATISTIC: ListsNotListedThatCopiesOfCalleesStoreInto >= 1
const rounds = +process.argv[2]! || 3;
function swap(list: any, i: any, j: any): void { const kept = list[i]; list[i] = list[j]; list[j] = kept; }
function turned(list: any, i: any, j: any): any { let s = 0; while (i < j) { swap(list, i, j); s += list[i]; i++; j--; } return s; }
const ends: any[] = JSON.parse("[0,7,2,5,0.5,3.5,-1,2,6,9,3,3,5,1]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) {
  for (const text of ["[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]", "[0,1,2,3,4,5,6,7]", '["a","b","c","d","e","f","g","h"]', "[0.5,null,2.5,3.5]"]) {
    for (let e = 0; e + 1 < ends.length; e += 2) {
      const list: any[] = JSON.parse(text);
      out.push(String(turned(list, ends[e], ends[e + 1])) + ":" + Object.keys(list).length + ":" + JSON.stringify(list).length);
    }
  }
}
console.log(out.join(" "));
