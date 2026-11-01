// A loop reads and writes one place on every turn: an element, a field. Whoever looks at the place, at whatever point the loop is left, finds what the turns so far have put there.
const values = new Int32Array(64);
for (let index = 0; index < values.length; index++) values[index] = (index * 7) % 11;

function intoElement(sums, place) {
  for (let index = 0; index < values.length; index++) sums[place] = sums[place] + values[index];
  return sums[place];
}

function intoNumber(sums, place) {
  for (let index = 0; index < values.length; index++) sums[place] += values[index] * 0.25;
  return sums[place];
}

function intoField(record) {
  for (let index = 0; index < values.length; index++) record.total = (record.total + values[index]) | 0;
  return record.total;
}

function intoList(list) {
  for (let index = 0; index < values.length; index++) list[2] = (list[2] + values[index]) | 0;
  return list[2];
}

function onSomeTurns(sums, place) {
  let seen = 0;
  for (let index = 0; index < values.length; index++) {
    seen += sums[place];
    if (values[index] & 1) sums[place] = sums[place] + index;
  }
  return seen + sums[place];
}

function leftEarly(sums, place, most) {
  for (let index = 0; index < values.length; index++) {
    sums[place] = sums[place] + values[index];
    if (sums[place] > most) break;
  }
  return sums[place];
}

function returnedFrom(sums, place, most) {
  for (let index = 0; index < values.length; index++) {
    sums[place] = sums[place] + values[index];
    if (sums[place] > most) return index;
  }
  return -1;
}

function leftByAnError(sums, place, most) {
  for (let index = 0; index < values.length; index++) {
    sums[place] = sums[place] + values[index];
    if (sums[place] > most) throw new RangeError("more than " + most);
  }
}

function leftByAReadOfNothing(sums, place, records) {
  for (let index = 0; index < records.length; index++) sums[place] = sums[place] + records[index].weight;
}

function inTwoLoops(sums, place, rounds) {
  for (let round = 0; round < rounds; round++) {
    for (let index = 0; index < values.length; index++) sums[place] = sums[place] + values[index];
    sums[place] += round;
  }
  return sums[place];
}

function eachElementInTurn(sums, rounds) {
  for (let place = 0; place < sums.length; place++) {
    for (let round = 0; round < rounds; round++) sums[place] = sums[place] + (round % 5);
    sums[place] += place;
  }
  return sums.join();
}

function outsideTheArray(sums, place) {
  for (let index = 0; index < 4; index++) sums[place] = sums[place] + 1;
  return String(sums[place]);
}

function noTurn(sums, place, turns) {
  for (let index = 0; index < turns; index++) sums[place] = sums[place] + 1;
  return sums === null ? "nothing" : sums[place];
}

console.log(intoElement(new Int32Array(4), 1), intoNumber(new Float64Array(4), 3), intoNumber(new Float32Array(4), 0));
console.log(intoField({ name: "first", total: 5 }), intoList([1, 2, 3, 4]), onSomeTurns(new Int32Array(4), 2));
const early = new Int32Array(4);
console.log(leftEarly(early, 1, 40), early.join(), returnedFrom(early, 2, 25), early.join());
const thrown = new Int32Array(4);
try {
  leftByAnError(thrown, 3, 30);
} catch (error) {
  console.log(error.message, thrown.join());
}
const missing = new Int32Array(4);
try {
  leftByAReadOfNothing(missing, 0, [{ weight: 3 }, { weight: 4 }, null, { weight: 5 }]);
} catch (error) {
  console.log(error instanceof TypeError, missing.join());
}
console.log(inTwoLoops(new Int32Array(4), 1, 9), eachElementInTurn(new Int32Array(6), 23));
console.log(
  outsideTheArray(new Int32Array(4), 9),
  outsideTheArray(new Int32Array(4), -1),
  outsideTheArray(new Float64Array(0), 0),
);
console.log(
  noTurn(null, 0, 0),
  noTurn(new Int32Array(1), 0, 0),
  noTurn(new Uint8Array(1), 0, 300),
  noTurn(new Uint8ClampedArray(1), 0, 300),
  noTurn(new Int8Array(1), 0, 200),
);
