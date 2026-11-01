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
const made = [0, ...src];
const seen = state + "";
console.log(seen, made.length | 0, made[2] | 0);
