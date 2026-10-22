class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fourth, fourth + 1);
  }
}
class Other extends Target {}
const made = Reflect.construct(Target, [0, 1, 2, 3.5, 4], Other);
