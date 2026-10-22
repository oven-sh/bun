// Code that runs once is shared where it repeats. The arms differ in nothing but the fraction that they answer.
var a = 0, b = 0, c = 0, d = 0, e = 0;
function read() {
  return a + b + c + d + e;
}
function pick(k) {
  switch (k) {
    case 0: a = 1; b = 2; c = 3; d = 4; e = 5; return 3.5;
    case 1: a = 1; b = 2; c = 3; d = 4; e = 5; return 21.5;
    case 2: a = 1; b = 2; c = 3; d = 4; e = 5; return 24.5;
    default: a = 1; b = 2; c = 3; d = 4; e = 5; return 0.125;
  }
}
console.log(pick(Date.now() > 0 ? 1 : 0), read());
