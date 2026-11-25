// The read of the name makes the text "Function", and the global object is read under it.
let held;
[0].forEach(function () {
  held = this;
});
const makers = {
  Function() {
    return 0;
  },
};
const pick = (holder, key) => holder[key];
console.log(pick(held, Object.values(makers)[0].name)(JSON.parse('"return 6 * 7"'))());
