let serial = 0;
function objectWithNewShape() {
  const object = { first: 0, second: 0, third: 0, fourth: 0 };
  object["unique" + serial++] = 1;
  return object;
}
export function newShapeOnly(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) if (objectWithNewShape() !== undefined) sum++;
  return sum;
}
export function replaceFour(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = objectWithNewShape();
    object.first = i;
    object.second = i;
    object.third = i;
    object.fourth = i;
    sum++;
  }
  return sum;
}
export function addFour(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = objectWithNewShape();
    object.fifth = i;
    object.sixth = i;
    object.seventh = i;
    object.eighth = i;
    sum++;
  }
  return sum;
}
export function readFour(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = objectWithNewShape();
    sum += object.first + object.second + object.third + object.fourth + 1;
  }
  return sum;
}
export function readFourMissing(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const object = objectWithNewShape();
    if (object.ninth === undefined && object.tenth === undefined && object.eleventh === undefined && object.twelfth === undefined) sum++;
  }
  return sum;
}
