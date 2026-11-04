let counter = 1;
const fixed = "fixed";
function read() { return counter + fixed; }
eval("counter = 5; var made = 7;");
const indirect = (0, eval)("typeof counter");
console.log(read(), typeof made, made, indirect, eval("fixed + counter"), (() => eval("counter++"))(), counter);
