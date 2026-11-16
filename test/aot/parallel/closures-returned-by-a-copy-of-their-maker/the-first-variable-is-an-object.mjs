const sink = [];
function borrow(job) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return job() + work;
}
function make(start, wants) {
  let box = { n: start };
  function add() { box = { n: box.n + 1 }; }
  add();
  if (wants) return () => box.n;
}
function once(n) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = borrow(make(n | 0, true));
  return got + work;
}
function drive() {
  let sum = 0;
  for (let t = 0; t < 400; t++) sum += once(t * 10);
  return sum;
}
console.log(make(5, false) === undefined, drive(), sink.length);
