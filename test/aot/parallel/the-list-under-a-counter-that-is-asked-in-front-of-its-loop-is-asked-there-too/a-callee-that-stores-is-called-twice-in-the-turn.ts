// STATISTIC: InlineeStoredArraysNotGuarded >= 1
const rounds = +process.argv[2]! || 3;
function swap(list: any, i: any, j: any): void { const kept = list[i]; list[i] = list[j]; list[j] = kept; }
function shaken(list: any, i: any, j: any): any { let s = 0; while (i < j) { swap(list, i, j); s += list[i]; swap(list, i, i + 1); s += list[j]; i++; j--; } return s; }
const ends: any[] = JSON.parse("[0,7,1,6,0.5,4.5,-2,3]");
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (let e = 0; e + 1 < ends.length; e += 2) { const list: any[] = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]"); out.push(String(shaken(list, ends[e], ends[e + 1])) + ":" + list.join()); }
console.log(out.join(" "));
