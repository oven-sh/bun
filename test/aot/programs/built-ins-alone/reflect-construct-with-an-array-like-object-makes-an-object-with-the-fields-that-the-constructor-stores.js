class Target {
  constructor(first, second, third, fourth, fifth) {
    this.first = first;
    this.second = second;
    this.third = third;
    this.fourth = fourth;
    this.fifth = fifth;
  }
}
const made = Reflect.construct(Target, { length: 5, 0: 1, 1: 2.5, 2: "three", 3: { four: 4 }, 4: () => "five" });
console.log(typeof made.first, made.first + 1);
console.log(typeof made.second, made.second + 1);
console.log(typeof made.third, made.third.length);
console.log(typeof made.fourth, made.fourth.four);
console.log(typeof made.fifth, made.fifth());
console.log(Object.keys(made).join());
