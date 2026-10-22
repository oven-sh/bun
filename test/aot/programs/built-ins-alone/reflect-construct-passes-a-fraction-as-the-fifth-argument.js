class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fifth, fifth + 1);
  }
}
const made = Reflect.construct(Target, [0, 1, 2, 3, 4.5]);
