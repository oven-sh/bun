// `Object.defineProperties(target, Object.getOwnPropertyDescriptors(definition))`: the definition is a literal with a getter, so the target gets its names, the getter as a getter.
function extend(target, definition) {
  return Object.defineProperties(target, Object.getOwnPropertyDescriptors(definition));
}
const shape = extend({ sides: 4 }, {
  side: 3,
  get perimeter() {
    return this.sides * this.side;
  },
  scale(factor) {
    return this.side * factor;
  },
});
let total = 0;
for (let i = 0; i < 3000000; i++) total += shape.perimeter + shape.scale(i & 3) + shape.sides;
console.log(total, Object.keys(shape).join(), typeof Object.getOwnPropertyDescriptor(shape, "perimeter").get);
