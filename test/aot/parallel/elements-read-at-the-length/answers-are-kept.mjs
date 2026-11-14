// table[table.length] in an inner loop whose stores convert the list in front of it: the length that was read before the conversion is the position of the read, not what bounds it.
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
  return String(v1) + " " + v2;
}
console.log(compute0(5), table0.join());

const whole = [1, 2, 3, 4];
function last(a) {
  let found = 1;
  let end = a;
  let turn = 0;
  while (turn < 3) {
    end = whole.length - 1;
    for (let i = 1; i < a && i < 6; i++) {
      found = whole[end];
      whole[turn & 3] = whole[turn & 3] * 0.5;
    }
    turn++;
  }
  return String(found) + " " + end;
}
console.log(last(5), whole.join());

const cut = [1, 2, 3, 4];
function behindCut(a) {
  let found = 1;
  let end = a;
  let turn = 0;
  while (turn < 3) {
    end = cut.length - 1;
    if (turn === 1) cut.length = 2;
    for (let i = 1; i < a && i < 6; i++) {
      found = cut[end];
      cut[turn & 1] = cut[turn & 1] * 0.5;
    }
    turn++;
  }
  return String(found) + " " + end;
}
console.log(behindCut(5), cut.join());
