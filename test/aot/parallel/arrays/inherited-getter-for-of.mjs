const unknown = JSON.parse('{"z":0,"n":1,"sp":"setPrototypeOf","dp":"defineProperty","list":[5,6]}');
let state = "before";
const sproto = Object.create(Array.prototype, {
  1: {
    get() {
      state = "after";
      return 9;
    },
    configurable: true,
  },
});
const src = [1, , 3];
Object[unknown.sp](src, sproto);
state = "again";
let s = 0;
for (const x of src) s += x | 0;
const seen = state + "";
console.log(seen, s | 0);
