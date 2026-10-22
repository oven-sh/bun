const result = new SuppressedError("text", "text", "x");
console.log(result instanceof SuppressedError, result.message);
