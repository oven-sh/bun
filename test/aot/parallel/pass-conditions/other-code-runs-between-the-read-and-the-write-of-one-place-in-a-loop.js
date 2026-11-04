// A loop reads one place and writes it on every turn, and between the two, or between two turns, other code runs: a call, a getter, the conversion of an operand.
// It may write the place, give the field another meaning, take the memory away or make the array shorter.
function addsWhatACallAnswers(sums, place, turns, next) {
  for (let turn = 0; turn < turns; turn++) sums[place] = sums[place] + next(turn);
  return sums[place];
}

function addsBehindACall(sums, place, turns, next) {
  for (let turn = 0; turn < turns; turn++) {
    const more = next(turn);
    sums[place] = sums[place] + more;
  }
  return sums[place];
}

function addsAField(sums, place, turns, record) {
  for (let turn = 0; turn < turns; turn++) sums[place] = sums[place] + record.weight;
  return sums[place];
}

function addsWhatIsConverted(sums, place, turns, value) {
  for (let turn = 0; turn < turns; turn++) sums[place] += value;
  return sums[place];
}

function addsIntoAField(record, turns, next) {
  for (let turn = 0; turn < turns; turn++) record.total = record.total + next(record, turn);
  return record.total;
}

function addsIntoAFieldBehindACall(record, turns, next) {
  for (let turn = 0; turn < turns; turn++) {
    next(record, turn);
    record.total = record.total + 1;
  }
  return record.total;
}

function addsIntoAList(list, turns, next) {
  for (let turn = 0; turn < turns; turn++) {
    list[1] = list[1] + 1;
    next(list, turn);
  }
  return list.join();
}

function addsUntil(sums, place, turns, at, then) {
  for (let turn = 0; turn < turns; turn++) {
    sums[place] = sums[place] + 1;
    if (turn === at) then(sums);
  }
  return `${sums[place]} of ${sums.length}`;
}

const first = new Int32Array(4);
console.log(addsWhatACallAnswers(first, 1, 10, turn => (turn === 5 ? (first[1] = 1000) : turn)));
const second = new Int32Array(4);
console.log(addsBehindACall(second, 1, 10, turn => (turn === 5 ? (second[1] = 1000) : turn)));
const third = new Float64Array(4).fill(1);
const doubles = {
  get weight() {
    third[2] *= 2;
    return 1;
  },
};
console.log(addsAField(third, 2, 10, doubles), addsAField(new Float64Array(4), 2, 10, { weight: 0.5 }));
const fourth = new Int32Array(4);
let conversions = 0;
const converted = {
  valueOf() {
    if (++conversions === 4) fourth[0] = -50;
    return 2;
  },
};
console.log(addsWhatIsConverted(fourth, 0, 10, converted), addsWhatIsConverted(new Int32Array(4), 0, 10, 3));

console.log(addsIntoAField({ total: 0 }, 10, (record, turn) => (turn === 5 ? (record.total = 100) : 1)));
console.log(addsIntoAFieldBehindACall({ total: 0 }, 10, (record, turn) => void (turn === 5 && (record.total = 100))));
let stored = 0;
const becomesAnAccessor = (record, turn) => {
  if (turn !== 5) return;
  Object.defineProperty(record, "total", { get: () => 7, set: () => void stored++ });
};
console.log(addsIntoAFieldBehindACall({ total: 0 }, 10, becomesAnAccessor), stored);
const isDeleted = (record, turn) => void (turn === 5 && delete record.total);
console.log(addsIntoAFieldBehindACall({ name: "x", total: 0 }, 10, isDeleted));
const getsManyFields = (record, turn) => {
  if (turn === 5) for (let field = 0; field < 100; field++) record["field" + field] = field;
};
console.log(addsIntoAFieldBehindACall({ total: 0 }, 10, getsManyFields));

console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && (list[1] = 100))));
console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && (list.length = 1))));
console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && (list[1] = 0.5))));
console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && (list[1] = "text"))));
console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && list.unshift(9))));
console.log(addsIntoAList([1, 2, 3], 10, (list, turn) => void (turn === 5 && (list[5000] = 1))).length);

console.log(addsUntil(new Int32Array(4), 2, 10, 5, sums => void sums.buffer.transfer()));
console.log(
  addsUntil(new Int32Array(4), 2, 10, 5, sums => void structuredClone(sums.buffer, { transfer: [sums.buffer] })),
);
console.log(
  addsUntil(new Int32Array(new ArrayBuffer(16, { maxByteLength: 64 })), 2, 10, 5, sums => sums.buffer.resize(4)),
);
console.log(
  addsUntil(new Int32Array(new ArrayBuffer(16, { maxByteLength: 64 })), 2, 10, 5, sums => sums.buffer.resize(64)),
);
const shrinksAndGrows = sums => {
  sums.buffer.resize(0);
  sums.buffer.resize(16);
};
console.log(addsUntil(new Int32Array(new ArrayBuffer(16, { maxByteLength: 64 })), 2, 10, 5, shrinksAndGrows));
console.log(addsUntil(new Int32Array(4), 2, 10, 5, sums => void sums.fill(40)));
console.log(addsUntil(new Int32Array(4), 2, 10, 5, sums => void new Uint8Array(sums.buffer).fill(1)));
console.log(addsUntil(new Int32Array(new SharedArrayBuffer(16)), 2, 10, 5, sums => void Atomics.add(sums, 2, 100)));
