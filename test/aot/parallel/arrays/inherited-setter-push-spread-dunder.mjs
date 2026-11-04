const unknown = JSON.parse('{"z":0,"n":1,"sp":"setPrototypeOf","dp":"defineProperty","list":[5,6]}');
let state = "before";
const proto = Object.create(Array.prototype, {
  1: {
    set(v) {
      state = "after";
    },
    get() {
      return 40;
    },
    configurable: true,
  },
  2: {
    set(v) {
      state = "after";
    },
    configurable: true,
  },
});
const arr = [7];
arr.__proto__ = proto;
function act(a, v) {
  state = "again";
  a.push(...unknown.list);
  return state + "";
}
console.log(act([1], 2), act(arr, 3), arr.length | 0);
