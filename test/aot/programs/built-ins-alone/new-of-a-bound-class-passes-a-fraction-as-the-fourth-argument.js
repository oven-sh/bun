class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fourth, fourth + 1);
  }
}
const made = new (Target.bind(null, 0, 1))(2, 3.5, 4);
