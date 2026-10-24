class Maker extends Function {}
const addOne = new Maker("x", "return x + 1");
console.log(addOne(1), addOne instanceof Maker);
