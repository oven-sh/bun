class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof first, first + 1);
    console.log(typeof second, second + 1);
    console.log(typeof third, third.length);
    console.log(typeof fourth, fourth.four);
    console.log(typeof fifth, fifth());
    console.log(arguments.length);
  }
}
const made = new (Target.bind(null, 1, 2.5))("three", { four: 4 }, () => "five");
console.log(made instanceof Target);
