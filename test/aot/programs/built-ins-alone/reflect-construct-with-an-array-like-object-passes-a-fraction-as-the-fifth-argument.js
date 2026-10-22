class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fifth, fifth + 1);
  }
}
const made = Reflect.construct(Target, { length: 5, 0: 0, 1: 1, 2: 2, 3: 3, 4: 4.5 });
