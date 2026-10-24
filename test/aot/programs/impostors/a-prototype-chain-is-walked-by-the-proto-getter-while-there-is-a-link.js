let link = { a: 1 };
let steps = 0;
while (link) {
  steps++;
  link = link.__proto__;
}
console.log(steps);
