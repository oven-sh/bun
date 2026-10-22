class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof first, first + 1);
  }
}
const made = new (Target.bind(null, 0.5, 1))(2, 3, 4);
