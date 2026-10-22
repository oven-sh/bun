const log = [];
const readers = [];
function Once() {
  let mine = readers.length;
  readers.push(() => mine);
  if (readers.length < 3) new (Object.getPrototypeOf(this).constructor)();
  mine += 10;
  log.push(mine);
}
new Once();
console.log(log.join(), readers.map(read => read()).join());
