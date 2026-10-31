// A sum of fractions is added up in loops and read behind calls. Where no register that holds a fraction outlives a call, the sum waits in the frame past the calls and has a register
// in each loop that writes it: it is taken from the frame on every way into the loop and left there on every way out on which somebody still reads it.
// So each form here leaves its loops in another way: by the condition, break, continue to a label, return, a throw that is caught, a loop that takes no turn, a call in a rare turn.
const unknown = value => JSON.parse(JSON.stringify(value));
const notes = [];
function note(value) { notes.push(value); return notes.length & 1; }
function fail(value) { throw new RangeError("at " + value); }
const kept = { note, fail };
const tell = value => kept[unknown("note")](value);
const raise = value => kept[unknown("fail")](value);

function behindCalls(turns, step) {
  let sum = 0.5;
  for (let i = 0; i < turns; i++) {
    if (i & 4) sum += step;
    else sum *= 0.75;
  }
  if (tell(1)) tell(2);
  if (tell(3)) tell(4);
  return sum;
}

function betweenCalls(turns, step) {
  let sum = 0.25;
  tell(sum);
  for (let i = 0; i < turns; i++) sum += step;
  tell(sum);
  for (let i = 0; i < turns; i++) sum -= step / 2;
  tell(sum);
  for (let i = turns; i > 0; i--) sum *= 1.5;
  tell(sum);
  return sum;
}

function leftByBreak(turns, step, limit) {
  let sum = 0.125;
  for (let i = 0; i < turns; i++) {
    sum += step;
    if (sum > limit) break;
    sum += 0.0625;
  }
  tell("break");
  return sum;
}

function leftByReturn(turns, step, limit) {
  let sum = 0.125;
  tell("return");
  for (let i = 0; i < turns; i++) {
    sum += step;
    if (sum > limit) return -sum;
  }
  tell("end");
  return sum;
}

function loopsInLoops(rows, columns, step) {
  let sum = 0.5;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) sum += step * column;
    sum /= 2;
  }
  tell("rows");
  return sum;
}

function callBetweenInnerLoops(rows, columns, step) {
  let sum = 0.5;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) sum += step;
    tell(sum);
    for (let column = 0; column < columns; column++) sum *= 0.5;
  }
  return sum;
}

function toLabel(rows, columns, step) {
  let sum = 0.75;
  outer: for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      sum += step;
      if (column === row) continue outer;
      if (sum > 40) break outer;
    }
    sum -= 0.25;
  }
  tell("label");
  return sum;
}

function callInRareTurn(turns, step) {
  let sum = 0.5;
  for (let i = 0; i < turns; i++) {
    sum += step;
    if (i % 1000 === 999) tell(sum);
  }
  tell("rare");
  return sum;
}

function caught(turns, step, limit) {
  let sum = 0.5;
  try {
    for (let i = 0; i < turns; i++) {
      sum += step;
      if (sum > limit) raise(i);
    }
  } catch (error) {
    tell(error.message);
    return sum * 2;
  } finally {
    tell("finally");
  }
  return sum;
}

function twoSums(turns, step) {
  let up = 0.5;
  let down = 100.5;
  for (let i = 0; i < turns; i++) {
    up += step;
    down -= step;
    if (up > down) {
      const swapped = up;
      up = down;
      down = swapped;
    }
  }
  tell(up);
  tell(down);
  return up / down;
}

function manySums(turns, step) {
  let a = 0.5, b = 1.5, c = 2.5, d = 3.5, e = 4.5, f = 5.5, g = 6.5, h = 7.5, i = 8.5, j = 9.5, k = 10.5, l = 11.5, m = 12.5, n = 13.5, o = 14.5, p = 15.5, q = 16.5, r = 17.5;
  for (let turn = 0; turn < turns; turn++) {
    a += step; b += a; c += step; d += c; e += step; f += e; g += step; h += g; i += step;
    j += i; k += step; l += k; m += step; n += m; o += step; p += o; q += step; r += q;
  }
  tell("many");
  return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r].join(" ");
}

function whileAndDo(turns, step) {
  let sum = 0.5;
  let left = turns;
  while (left-- > 0) sum += step;
  tell("while");
  left = turns;
  do sum -= step / 4; while (--left > 0);
  tell("do");
  return sum;
}

function overList(list) {
  let sum = 0.5;
  for (const value of list) sum += value;
  tell("of");
  for (let i = 0; i < list.length; i++) sum += list[i] / 2;
  tell("index");
  return sum;
}

function notAlwaysWritten(turns, step, flag) {
  let sum = 0.5;
  tell("first");
  if (flag) for (let i = 0; i < turns; i++) sum += step;
  tell("second");
  return sum;
}

function becomesNoNumber(turns, values) {
  let sum = 0.5;
  for (let i = 0; i < turns; i++) sum += values[i & 3];
  tell("values");
  return sum;
}

const forms = {
  behindCalls, betweenCalls, leftByBreak, leftByReturn, loopsInLoops, callBetweenInnerLoops, toLabel, callInRareTurn, caught, twoSums, manySums, whileAndDo, notAlwaysWritten,
};
for (const name of Object.keys(forms)) {
  for (const turns of [0, 1, 2, 7, 100, 2500]) {
    for (const step of [0.25, 1.5, -0.125]) {
      notes.length = 0;
      const answer = forms[unknown(name)](unknown(turns), name.includes("oops") || name === "toLabel" ? unknown(Math.min(turns, 9)) : unknown(step), name.includes("oops") || name === "toLabel" ? unknown(step) : unknown(turns & 1 ? 3.5 : 30));
      console.log(name, turns, step, answer, notes.length, notes.slice(-3).join("|"));
    }
  }
}
for (const list of [[], [0.5], [1, 2, 3], [0.25, -0.5, 1e300, -1e300], Array.from({ length: 300 }, (_, index) => index / 8)]) {
  notes.length = 0;
  console.log("overList", list.length, forms.behindCalls === behindCalls, kept.note === note, overList(unknown(list)), notes.join("|"));
}
for (const values of [[0.5, 1.5, 2.5, 3.5], [1, 2, 3, 4], [0.5, undefined, 1, 2], [0.5, "x", 1, 2], [0.5, null, true, -0]]) {
  for (const turns of [0, 1, 3, 9]) {
    notes.length = 0;
    console.log("becomesNoNumber", turns, becomesNoNumber(unknown(turns), values), notes.join("|"));
  }
}
// More turns than a loop takes between two looks at the clock.
console.log(behindCalls(unknown(3000000), unknown(0.25)), callInRareTurn(unknown(2200000), unknown(0.5)), loopsInLoops(unknown(3), unknown(1200000), unknown(0.001)));
