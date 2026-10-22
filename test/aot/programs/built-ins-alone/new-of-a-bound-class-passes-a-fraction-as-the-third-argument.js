class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof third, third + 1);
  }
}
const made = new (Target.bind(null, 0, 1))(2.5, 3, 4);
