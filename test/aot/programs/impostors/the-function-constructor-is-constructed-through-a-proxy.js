const proxy = new Proxy(Function, {});
const addOne = new proxy("x", "return x + 1");
console.log(addOne(1));
