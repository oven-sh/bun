// Six loops over a DataView. Each reads a method of DataView.prototype that nothing has read before: one loop makes no turn, one throws in its first turn in front of a second method,
// one reads a method only from its fourth turn on, one leaves in front of the read, one stands in another loop, one reads in its test. Behind each loop another method is read, so that
// the own keys of DataView.prototype tell which of the loops read what, and when.
const view = new DataView(new ArrayBuffer(64));
function noTurn(count) {
  let sum = 0;
  for (let at = 0; at < count; at += 8) sum += view.getFloat64(at, true);
  return sum;
}
function throwsInFirstTurn(count) {
  let sum = 0;
  for (let at = 0; at < count; at += 8) {
    sum += view.getFloat32(at + 62, true);
    sum += view.getInt32(at, true);
  }
  return sum;
}
function fromFourthTurn(count) {
  let sum = 0;
  for (let at = 0; at < count; at++) {
    if (at > 2) sum += view.getUint8(at);
    else sum += view.getInt8(at);
  }
  return sum;
}
function leavesFirst(count, stop) {
  let sum = 0;
  for (let at = 0; at < count; at += 2) {
    if (stop) break;
    sum += view.getInt16(at, true);
  }
  return sum;
}
function nested(rows, columns) {
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column += 2) sum += view.getUint16(column, true);
  }
  return sum;
}
function inTest(limit) {
  let turns = 0;
  while (view.getUint32(0, true) + turns < limit) turns++;
  return turns;
}
const shown = [];
shown.push(noTurn(0));
view.setInt8(0, 1);
try {
  throwsInFirstTurn(64);
} catch (error) {
  shown.push(error.name);
}
view.setUint8(1, 2);
shown.push(fromFourthTurn(2));
view.setInt16(2, 3);
shown.push(fromFourthTurn(8));
view.setUint16(4, 4);
shown.push(leavesFirst(64, true));
view.setInt32(8, 5);
shown.push(nested(3, 0));
view.setUint32(12, 6);
shown.push(nested(0, 8));
view.setFloat32(16, 7);
shown.push(inTest(0));
view.setFloat64(24, 8);
shown.push(noTurn(64), leavesFirst(64, false), nested(2, 8), throwsInFirstTurn(0));
console.log(shown.join());
console.log(Object.entries(DataView.prototype).length);
console.log(Reflect.ownKeys(DataView.prototype).map(String).join());
