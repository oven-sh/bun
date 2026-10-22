const result = new AggregateError("an", "-", 3.5);
console.log(result instanceof AggregateError, result.message);
