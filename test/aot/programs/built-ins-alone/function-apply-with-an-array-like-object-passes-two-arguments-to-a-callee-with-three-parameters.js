function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
}
target.apply(undefined, { length: 2, 0: 1.5, 1: "two" });
