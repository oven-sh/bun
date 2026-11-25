// table0[table0.length] in an inner loop whose stores convert the list in front of it: the length that was read before the conversion is the position of the read, not what bounds it.
const table0 = [2.5, 5, 0.5, 2];
function compute0(a) {
  let v1 = 1;
  let v2 = a;
  let i4 = 0;
  while (i4 < 3) {
    v2 = table0.length;
    for (let i5 = 1; i5 < a && i5 < 6; i5++) {
      v1 = table0[v2];
      table0[i4 & 3] = table0[i4 & 3];
    }
    i4++;
  }
}
console.log(compute0(5));
