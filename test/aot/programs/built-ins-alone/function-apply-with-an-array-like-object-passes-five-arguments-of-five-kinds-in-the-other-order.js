function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
  console.log(typeof fourth, fourth + 1);
  console.log(typeof third, third.length);
  console.log(typeof second, second.four);
  console.log(typeof first, first());
  console.log(arguments.length);
}
target.apply(undefined, { length: 5, 0: () => "five", 1: { four: 4 }, 2: "three", 3: 2.5, 4: 1 });
