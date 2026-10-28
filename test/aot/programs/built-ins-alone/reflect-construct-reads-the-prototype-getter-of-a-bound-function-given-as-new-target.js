const bound = function () {}.bind();
let counter = 0;
Object.defineProperty(bound, "prototype", {
  get() {
    ++counter;
    return {};
  },
});
for (let i = 0; i < 3; ++i) Reflect.construct(function () {}, [], bound);
console.log(counter);
