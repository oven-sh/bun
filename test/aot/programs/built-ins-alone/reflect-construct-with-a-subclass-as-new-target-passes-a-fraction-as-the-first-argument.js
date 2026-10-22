class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof first, first + 1);
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [0.5, 1, 2, 3, 4], Other);
