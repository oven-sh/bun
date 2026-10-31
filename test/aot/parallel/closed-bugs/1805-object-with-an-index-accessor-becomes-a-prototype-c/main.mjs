// Flags: --aot-validate
const above = {};
const o = { __proto__: above, 0: 2 };
o[0]++;
Object.setPrototypeOf(above, {
  get 0() {
    return "got";
  },
  set 0(given) {},
});
o[1] = 5;
console.log(o[0], o[1], Object.keys(o).join());
