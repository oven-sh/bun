function make(flag) {
  class Point {}
  class First { take() { return () => Point; } }
  class Second { take() { return () => [Point]; } }
  return (flag ? new First() : new Second()).take();
}
console.log(typeof make(true)(), typeof make(false)(), make(true)().name, make(false)()[0].name);
