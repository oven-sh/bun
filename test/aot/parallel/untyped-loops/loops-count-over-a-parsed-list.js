// Every way to count over a list that comes out of JSON.parse, so that nobody knows it is a list until the loop has asked: `i < n`, `i++ < n`, `++i < n`, do-while, `i-- > 0`, `while (i--)`.
const lines = [];

function forward(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum = (sum + values[i]) | 0;
  return sum;
}
function steppedInTheTest(values) {
  let sum = 0, i = 0;
  while (i++ < values.length) sum = (sum + values[i - 1]) | 0;
  return sum + ":" + i;
}
function steppedAheadOfTheTest(values) {
  let sum = 0, i = -1;
  while (++i < values.length) sum = (sum + values[i]) | 0;
  return sum + ":" + i;
}
function testedAtTheEnd(values) {
  let sum = 0, i = 0;
  do {
    sum = (sum + values[i]) | 0;
  } while (++i < values.length);
  return sum + ":" + i;
}
function downToOne(values) {
  let sum = 0, i = values.length;
  for (; i-- > 0; ) sum = (sum * 31 + values[i]) | 0;
  return sum + ":" + i;
}
function downWhileTrue(values, most) {
  let sum = 0, i = values.length, turns = 0;
  while (i--) {
    sum = (sum * 31 + values[i]) | 0;
    if (++turns === most) break;
  }
  return sum + ":" + i + ":" + turns;
}
function oddOnes(values) {
  let count = 0;
  for (let i = 0; i < values.length; i++) if (values[i] & 1) count++;
  return count;
}
// The body wants the counter as a value.
function positions(values) {
  const found = [];
  let i = -1;
  while (++i < values.length) if (values[i] > 2) found.push(i);
  return found.join();
}
// The list grows and shrinks while the loop looks at its length.
function shrinks(values) {
  let seen = 0, i = -1;
  while (++i < values.length) {
    seen += values[i];
    if (i % 3 === 0) values.pop();
  }
  return seen + ":" + i;
}
function grows(values) {
  let seen = 0, i = 0;
  while (i++ < values.length) {
    seen += values[i - 1];
    if (values.length < 12) values.push(i);
  }
  return seen + ":" + i;
}

const all = [forward, steppedInTheTest, steppedAheadOfTheTest, testedAtTheEnd, downToOne, values => downWhileTrue(values, 40), oddOnes, positions];

function say(name, values) {
  for (const loop of all) {
    let answer;
    try {
      answer = loop(values);
    } catch (error) {
      answer = error.constructor.name;
    }
    lines.push(name + " " + (loop.name || "downWhileTrue") + " " + answer);
  }
}

const parsed = text => JSON.parse(text);

// Often enough with lists for each loop to have been what it is expected to be.
for (let round = 0; round < 3; round++) {
  say("numbers", parsed("[1,2,3,4,5,6,7]"));
  say("one", parsed("[9]"));
  say("none", parsed("[]"));
  say("fractions", parsed("[1.5,2.25,-3.75,1e10]"));
}
say("mixed", parsed('[1,"2",null,true,[4],{"a":1}]'));

const holes = parsed("[1,2,3,4,5]");
delete holes[2];
say("holes", holes);

const long = parsed("[1,2,3]");
long.length = 30;
say("longer than its elements", long);

say("bytes", new Uint8Array([250, 251, 252, 253]));
say("floats", new Float64Array([0.5, 1.5, -2.5]));
say("text", "12345");
say("nothing of a length", parsed("{}"));

// What only looks like a list: the counter starts at, or is compared with, whatever `length` is.
for (const length of [3, 0, -1, -0, 2.5, -2.5, NaN, "3", "x", null, true, 2147483647, 2147483648, 4294967295, 4294967296, -2147483648, -2147483649, 9007199254740992, Infinity, -Infinity]) {
  const looksLikeList = parsed('{"0":5,"1":6,"2":7}');
  looksLikeList.length = length;
  lines.push("length " + String(length) + " down " + downWhileTrue(looksLikeList, 5));
  if (!(length > 100)) {
    lines.push("length " + String(length) + " up " + steppedAheadOfTheTest(looksLikeList) + " " + steppedInTheTest(looksLikeList) + " " + testedAtTheEnd(looksLikeList) + " " + forward(looksLikeList));
    lines.push("length " + String(length) + " downToOne " + downToOne(looksLikeList));
  }
}
for (const length of [3n, 0n, -2n, { valueOf: () => 2 }, { valueOf: () => 2n }, Symbol.iterator]) {
  const looksLikeList = { 0: 5, 1: 6, 2: 7, length };
  for (const loop of [values => downWhileTrue(values, 5), downToOne, steppedAheadOfTheTest, steppedInTheTest]) {
    let answer;
    try {
      answer = loop(looksLikeList);
    } catch (error) {
      answer = error.constructor.name;
    }
    lines.push("length of type " + typeof length + " " + answer);
  }
}

// `length` is read anew in every turn.
let reads = 0;
const counted = {
  0: 1, 1: 2, 2: 3, 3: 4,
  get length() {
    return ++reads < 4 ? 4 : 2;
  },
};
lines.push("a getter " + steppedAheadOfTheTest(counted) + " " + reads);

lines.push("shrinks " + shrinks(parsed("[1,2,3,4,5,6,7,8,9]")));
lines.push("grows " + grows(parsed("[1,2,3]")));

// After all that, lists again.
say("numbers again", parsed("[7,6,5,4,3,2,1]"));

console.log(lines.join("\n"));
