const result = AggregateError("text", "-", "text");
console.log(result instanceof AggregateError, result.message);
