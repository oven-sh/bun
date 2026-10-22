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
class Other extends Target {}
const made = Reflect.construct(Target, [1, 2.5, "three", { four: 4 }, () => "five"], Other);
console.log(made instanceof Target);
