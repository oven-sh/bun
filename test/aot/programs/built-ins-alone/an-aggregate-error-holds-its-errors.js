const error = new AggregateError([{ code: 1.5 }, "two"], "failed");
console.log(error.errors.length, error.errors[0].code + 1, error.errors[1].length, error.message.length);
