const handlers = [];
const kept = [];
function install(callback) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  kept.push(callback);
  handlers.push((n) => callback(n));
  return work;
}
function boot(base) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  install((x) => (x + base) | 0);
  return work;
}
console.log(boot(40));
Bun.gc(true);
console.log(handlers[0](2), kept.length);
