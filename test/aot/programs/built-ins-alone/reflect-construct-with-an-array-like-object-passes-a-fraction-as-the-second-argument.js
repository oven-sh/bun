class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof second, second + 1);
  }
}
const made = Reflect.construct(Target, { length: 5, 0: 0, 1: 1.5, 2: 2, 3: 3, 4: 4 });
