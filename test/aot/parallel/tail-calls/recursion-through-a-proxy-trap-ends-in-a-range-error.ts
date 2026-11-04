// a small trap of a proxy reads the proxy without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
const proxy: any = new Proxy(
  {},
  {
    get(target, key) {
      turns++;
      if (limit && turns >= limit) return 0;
      return proxy[key] + 1;
    },
  },
);
function deed() {
  turns = 0;
  try {
    return String(proxy.x);
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
