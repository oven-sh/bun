const handlers = [];
function install(callback) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  handlers.push((n) => callback(n));
  return work;
}
function borrow(callback) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return (work + callback(2)) | 0;
}
function boot() {
  let near = 0;
  let far = 0;
  for (let i = 0; i < 4; i++) {
    near = (near + i) | 0;
    far = (far + 1000) | 0;
  }
  install((x) => (x + near) | 0);
  console.log(handlers[0](1));
  console.log(borrow((x) => (x + far) | 0));
  console.log(handlers[0](1));
}
boot();
console.log(handlers[0](1));
