// The collector: object below read. It prints what plain Bun prints.
class Below extends Object {
  constructor(value, tag) {
    super(value);
    this.tag = tag;
  }
}
class Other {}
const given = { first: 1.5, second: "two", third: [3], fourth: { four: 4 } };
function viaReflect(target) {
  return Reflect.construct(Object, [given], target);
}
for (let i = 0; i < 3; i++) {
  const reflected = viaReflect(i % 2 ? Below : Other);
  console.log(reflected === given, reflected.first, reflected.second, reflected.third, reflected.fourth, Object.keys(reflected).length, Object.getPrototypeOf(reflected) === (i % 2 ? Below : Other).prototype);
  const direct = Reflect.construct(Object, [given], Other);
  console.log(direct === given, direct.first, direct.second, direct.third, direct.fourth, Object.keys(direct).length);
  const same = Reflect.construct(Object, [given], Object);
  console.log(same === given, same.first, same.second);
}
