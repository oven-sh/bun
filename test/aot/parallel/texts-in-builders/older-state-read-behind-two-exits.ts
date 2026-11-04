// the loop has two ways out, and an older state of the growing text is read behind both: on the first it is the newest state, on the second the text has grown since
function grow(n: number, first: number, second: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const t1 = s + "a" + i;
    if (i === first) return "first " + t1;
    s = t1 + "b" + i;
    if (i === second) return "second " + t1 + "|" + s;
  }
  return "end " + s;
}
console.log(grow(0, 9, 9));
console.log(grow(3, 9, 9));
console.log(grow(3, 0, 9), grow(3, 2, 9));
console.log(grow(3, 9, 0), grow(3, 9, 2));
let lengths = 0;
for (let turn = 0; turn < 40; turn++) lengths += grow(turn, turn - 2, 9).length * 3 + grow(turn, 99, turn - 3).length;
console.log(lengths);
