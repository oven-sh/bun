class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof second, second + 1);
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [0, 1.5, 2, 3, 4], Other);
