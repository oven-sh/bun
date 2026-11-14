const handlers = [];
function install(callback) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  handlers.push((n) => callback(n));
  return work;
}
function boot(base) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  install(async (x) => (x + base) | 0);
  return work;
}
function dig(depth) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return depth > 0 ? (dig(depth - 1) + work) | 0 : 0;
}
console.log(boot(40), dig(300));
console.log(await handlers[0](2));
