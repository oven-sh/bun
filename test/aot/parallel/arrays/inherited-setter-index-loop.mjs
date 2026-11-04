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
Object[unknown.sp](arr, proto);
const lists = [[1], [1], arr];
let out = "";
const v = 3;
for (let i = 0; i < 3; i++) {
  const a = lists[i];
  state = "again";
  a[1] = v;
  out += state + " ";
}
console.log(out + "", arr.length | 0);
