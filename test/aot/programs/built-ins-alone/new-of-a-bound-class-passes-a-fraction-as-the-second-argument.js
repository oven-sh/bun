class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof second, second + 1);
  }
}
const made = new (Target.bind(null, 0, 1.5))(2, 3, 4);
