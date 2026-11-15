class Box {
  constructor(n) {
    this.count = n;
    this.note = 0;
  }
}
function a() {
  return this.count + 1;
}
function b() {
  return this.count + 2;
}
function c() {
  return this.count + 3;
}
function d() {
  return this.count + 4;
}
class Base {
  static call(box) {
    box.count = "text";
    return "static";
  }
}
class e extends Base {}
function through(handed, box) {
  return handed.call(box);
}
function pick(i) {
  return i === 0 ? a : i === 1 ? b : i === 2 ? c : i === 3 ? d : e;
}
function all(box) {
  let sum = "";
  for (let i = 0; i < 5; i++) sum += through(pick(i), box) + ",";
  return sum + box.count + "," + box.note + "," + typeof box.count;
}
console.log(all(new Box(10)));
console.log(all(new Box(20)));
