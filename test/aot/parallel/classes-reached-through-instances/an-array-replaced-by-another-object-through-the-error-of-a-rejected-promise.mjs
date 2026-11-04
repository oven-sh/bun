TypeError.list = [1, 2];
await Promise.reject(1)
  .then(() => 0)
  .catch(() => null.x)
  .catch(e => {
    e.constructor.list = { length: 3 };
  });
function read() {
  return TypeError.list.length;
}
console.log(read());
