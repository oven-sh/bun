let link = { a: 1 };
let steps = 0;
while (link) {
  steps++;
  link = Reflect.getPrototypeOf(link);
}
console.log(steps);
