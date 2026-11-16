function Pair(seed) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.first = seed;
  var never;
  let self = this;
  let seen;
  do {
    seen = typeof self.second;
    self = this;
  } while (never === 1);
  this.second = seed + work;
  this.seen = seen;
}
let last = "";
for (let i = 0; i < 300; i++) {
  const made = new Pair(i);
  last = made.seen + " " + made.second;
}
console.log(last);
console.log((0, eval)("1 + 1"));
