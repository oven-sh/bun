function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
  clearInterval(this);
}
setInterval(target, 1, 1.5, "two");
