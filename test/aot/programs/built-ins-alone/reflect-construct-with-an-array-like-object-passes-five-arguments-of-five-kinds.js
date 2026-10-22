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
const made = Reflect.construct(Target, { length: 5, 0: 1, 1: 2.5, 2: "three", 3: { four: 4 }, 4: () => "five" });
console.log(made instanceof Target);
