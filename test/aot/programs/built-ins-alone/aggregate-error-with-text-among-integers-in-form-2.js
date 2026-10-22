const result = new AggregateError("text", "-", "text");
console.log(result instanceof AggregateError, result.message);
