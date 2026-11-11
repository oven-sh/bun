// A method called on a Proxy: the trap is asked for the method, once a call, and the method runs with the Proxy as its receiver.
const asked = [];
const target = {
  base: 10,
  add(a, b) {
    return this === proxy ? this.base + a + b : "another receiver";
  },
  none() {
    return arguments.length;
  },
};
const proxy = new Proxy(target, {
  get(target, name, receiver) {
    asked.push(String(name) + (receiver === proxy ? "" : "?"));
    return target[name];
  },
});
function call(holder, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += holder.add(i, 1) + holder.none();
  return sum;
}
console.log(call(proxy, 3), asked.join());
console.log(call(target, 2), asked.length);
console.log(call(proxy, 200), asked.length);
