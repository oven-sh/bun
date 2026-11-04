let kept: number[] = [];
function grows(a: number): string { const list = [a, 1]; let s = 0; for (let i = 0; i < list.length; i++) { if (list.length < 5) list.push(i * 10); s += list[i]; } return s + ":" + list.join(); }
function growsForLong(a: number): number { const list = [a]; let s = 0; for (let i = 0; i < list.length; i++) { if (list.length < 40) list.push(i); s += list[i]; } return s; }
function shrinks(a: number): string { const list = [a, 1, 2, 3]; let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; list.pop(); } return s + ":" + list.join(); }
function cutsLength(a: number): string { const list = [a, 1, 2, 3]; let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; list.length = 2; } return s + ":" + list.join(); }
function stores(a: number): string { const list: (number | string)[] = [a, 1, 2]; let s = ""; for (let i = 0; i < list.length; i++) { list[2 - i] = "x" + i; s += list[i]; } return s + ":" + list.join(); }
function leaves(a: number): string { const list = [a, 1, 2]; let s = 0; for (let i = 0; i < list.length; i++) { if (i === 1) kept = list; kept.push(7); s += list[i]; if (s > 60) break; } return s + ":" + list.length; }
function isReplaced(a: number): number { let list = [a, 1, 2]; let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === 0) list = [a, 1, 2, 3, 4]; } return s; }
let carried = 0;
for (let i = 0; i < 4; i++) {
  kept = [];
  console.log(grows(i), growsForLong(i), shrinks(i), cutsLength(i), stores(i), leaves(i), isReplaced(i));
  carried += growsForLong(i) + isReplaced(i);
}
console.log(carried);
