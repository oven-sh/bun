let link = { a: 1 };
let steps = 0;
while (link !== null) {
  steps++;
  link = Object.getPrototypeOf(link);
}
console.log(steps);
