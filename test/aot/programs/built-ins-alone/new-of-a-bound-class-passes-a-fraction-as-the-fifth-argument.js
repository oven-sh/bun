class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fifth, fifth + 1);
  }
}
const made = new (Target.bind(null, 0, 1))(2, 3, 4.5);
