// `made` is a counter in one class and a method in the other. What is read is given properties on both sides of a long call.
class Ring {
  constructor() {
    this.made = 0;
  }
  bump() {
    this.made = (this.made + 1) | 0;
    return this.made;
  }
}
class Host {
  made(p, q) {
    return "called";
  }
}
const ring = new Ring();
const hosts = JSON.parse("[0]").map(() => Host.prototype);
let calls = 0;
const callee = [
  function () {
    calls += arguments.length;
    return 0;
  },
  function () {
    calls++;
    return 1;
  },
][JSON.parse("1")];
function turn(h, i) {
  h.made.a = i;
  callee(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139);
  h.made.z = 3;
}
for (let i = 0; i < 2000; i++) {
  ring.bump();
  turn(hosts[0], i);
}
console.log(ring.made, Host.prototype.made.a, Host.prototype.made.z, calls);
