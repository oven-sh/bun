// The data of a listener, and some of its options, are copied under keys that are made at run time. A read under such a key may find what every object inherits. Bun.listen reads its options under their names and keeps the data as it is: it iterates, converts and prints nothing of either.
// STATISTIC: ImageFunctionsEmitted <= 30
const store = { HOSTNAME: "127.0.0.1", A: "x" };
function copyOf(text) {
  const copy = {};
  for (const name of JSON.parse(text)) copy[name] = store[name.toUpperCase()];
  return copy;
}
const listener = Bun.listen({ ...copyOf('["hostname"]'), port: 0, socket: { data() {} }, data: copyOf('["a"]') });
console.log(typeof listener.port, listener.data.a);
listener.stop(true);
