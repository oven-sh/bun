const error = new SuppressedError({ code: 1.5 }, "two", "failed");
console.log(error.error.code + 1, error.suppressed.length, error.message.length);
