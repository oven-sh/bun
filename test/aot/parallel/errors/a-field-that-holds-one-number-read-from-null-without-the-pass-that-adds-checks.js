// Flags: --aot-disable=pass:InsertObjectCoercibleChecks
// Every object that reaches these reads holds the same number in the field, so the compiler knows what a read that succeeds gives. One that is handed null or undefined throws all the same.
// The compiler's own message on a crash tells people to build with --aot-disable=pass:<Name>: a program built that way means what it meant.
function pick(i) {
  return i % 2 ? null : { a: 1 };
}
function read(o) {
  return o.a;
}
function pickUndefined(i) {
  return i % 2 ? undefined : { b: 0.5 };
}
function readFraction(o) {
  return o.b;
}
class Point {
  x = 7;
}
function pickPoint(i) {
  return i % 2 ? null : new Point();
}
function readField(point) {
  return point.x;
}
for (let i = 0; i < 4; i++) {
  try {
    console.log(read(pick(i)));
  } catch (error) {
    console.log(error.constructor.name + ": " + error.message);
  }
  try {
    console.log(readFraction(pickUndefined(i)));
  } catch (error) {
    console.log(error.constructor.name + ": " + error.message);
  }
  try {
    console.log(readField(pickPoint(i)));
  } catch (error) {
    console.log(error.constructor.name + ": " + error.message);
  }
}
