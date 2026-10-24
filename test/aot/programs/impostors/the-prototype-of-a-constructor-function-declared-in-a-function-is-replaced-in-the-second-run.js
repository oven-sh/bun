const replacement = {};
function swap(A) {
  A.prototype = replacement;
}
function body(round) {
  function A(x) {
    this.value = x;
  }
  function make(n) {
    return new A(n);
  }
  const original = A.prototype;
  const made = [];
  for (let i = 0; i < 4; i++) {
    if (round === 1 && i === 2) swap(A);
    made.push(make(20));
  }
  console.log(made.map(o => (o.__proto__ === original ? "original" : o.__proto__ === replacement ? "replacement" : "other")).join());
}
body(0);
body(1);
