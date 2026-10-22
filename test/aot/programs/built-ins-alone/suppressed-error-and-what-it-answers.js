const result = SuppressedError(1.5, 2.5, "x");
console.log(result instanceof SuppressedError, result.message);
