const log = [];
const readers = [];
new (function () {
  let mine = readers.length;
  readers.push(() => mine);
  if (readers.length < 3) new this.constructor();
  mine += 10;
  log.push(mine);
})();
console.log(log.join(), readers.map(read => read()).join());
