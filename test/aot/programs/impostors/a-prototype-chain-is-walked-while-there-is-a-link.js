let link = { a: 1 };
let steps = 0;
while (link) {
  steps++;
  link = Object.getPrototypeOf(link);
}
console.log(steps);
