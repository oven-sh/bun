// A getter that replaces itself by a data field at the first read
function lazy(size) {
  let made = 0;
  const object = {
    get table() {
      made++;
      const value = Array.from({ length: size }, (_, i) => i * size);
      Object.defineProperty(this, "table", { value, enumerable: true });
      return value;
    },
  };
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += object.table.length + object.table.reduce((a, b) => a + b, 0);
  return sum + " made " + made;
}
console.log(lazy(2));
console.log(lazy(5));
console.log(lazy(0));
