const made = Function.apply(null, ["left", "right", "return left + right"]);
console.log(`${made(3, 4)}`);
