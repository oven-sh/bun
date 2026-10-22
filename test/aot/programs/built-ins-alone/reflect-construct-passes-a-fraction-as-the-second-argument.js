class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof second, second + 1);
  }
}
const made = Reflect.construct(Target, [0, 1.5, 2, 3, 4]);
