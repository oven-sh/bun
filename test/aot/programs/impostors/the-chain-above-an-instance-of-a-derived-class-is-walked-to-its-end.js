class Top {}
class Middle extends Top {}
let link = new Middle();
let steps = 0;
while (link) {
  link = Object.getPrototypeOf(link);
  steps++;
}
console.log(steps, link);
