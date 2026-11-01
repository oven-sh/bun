// The likely way through a turn sets `a` to 9. The test of the next turn then goes the unlikely way, and that way must be taken with what it gave `a`.
const table = {
  text(x) {
    return Object.is(x, -0) ? "-0" : String(x);
  },
  orSeven(x) {
    return x === undefined ? 7 : x;
  },
};
const names = JSON.parse('["text", "orSeven"]');
const text = table[names[0]];
const orSeven = table[names[1]];

function alternates() {
  let out = "";
  let turns = 0;
  let a = orSeven();
  for (let x = 0; x < 8 && turns++ < 6; x++) {
    if (a === 9) a = 3;
    else a = 9;
    out += text((a + a) >>> 0) + " ";
  }
  return out + a;
}
function startsOnTheUnlikelyWay(start) {
  let out = "";
  let a = orSeven(start);
  for (let x = 0; x < 7; x++) {
    if (a === 9) a = 3;
    else a = 9;
    out += text(a * 2) + " ";
  }
  return out + a;
}
function threeValues(start) {
  let out = "";
  let a = orSeven(start);
  for (let x = 0; x < 9; x++) {
    if (a === 9) a = 3;
    else if (a === 3) a = 4;
    else a = 9;
    out += text(a + 1) + " ";
  }
  return out + a;
}
function keptBesideACount(start) {
  let a = orSeven(start);
  let threes = 0;
  let nines = 0;
  for (let x = 0; x < 1000; x++) {
    if (a === 9) a = 3;
    else a = 9;
    text(a);
    if (a === 3) threes++;
    else nines++;
  }
  return [threes, nines, a].join();
}
for (let round = 0; round < 3; round++) {
  console.log(alternates());
  console.log(startsOnTheUnlikelyWay(9), "|", startsOnTheUnlikelyWay(3), "|", startsOnTheUnlikelyWay("text"));
  console.log(threeValues(9), "|", threeValues(3), "|", threeValues(4));
  console.log(keptBesideACount(9), keptBesideACount(7));
}
