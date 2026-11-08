const log = [];
function track(read) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  log.push(typeof read);
  return { n: 6 + work, [Symbol.dispose]() { log.push("closed " + read()); } };
}
function run() {
  let turns = 0;
  for (using r = track(() => r.n); turns < 2; turns++) log.push("turn " + r.n);
  return log.join();
}
console.log(run());
