// Destructuring order with getters: compiled answers as plain.
const log = [];
const src = {
  get a() {
    log.push("get a");
    return 1;
  },
  get b() {
    log.push("get b");
    return 2;
  },
};
const { b, a, ...rest } = src;
console.log(a, b, JSON.stringify(rest), log.join());
