const result = new SuppressedError("an", 2.5, "x");
console.log(result instanceof SuppressedError, result.message);
