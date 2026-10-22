class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof third, third + 1);
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [0, 1, 2.5, 3, 4], Other);
