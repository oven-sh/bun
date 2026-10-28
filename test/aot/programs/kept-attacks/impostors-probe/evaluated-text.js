// Impostors probe: evaluated text. It prints what plain Bun prints.
const made = (0, eval)("[1, 2, 3]");
made.push(4);
console.log(made.join(), new Function("a", "b", "return a + b")(2, 3));
