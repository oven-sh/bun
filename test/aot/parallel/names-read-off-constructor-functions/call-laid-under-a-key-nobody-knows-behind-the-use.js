const unseen = (x) => [x][JSON.parse("0")];
function Base(a) { this.a = a; }
function Below(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  Base.call(this, a);
  this.b = b + work;
}
Below.prototype = Object.create(Base.prototype);
function run(count, key) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += new Below(i, 1).a;
    if (i === 4) Base[key] = function (self, a) { self.a = a + 100; };
  }
  return sum;
}
console.log(run(10, unseen("call")));
