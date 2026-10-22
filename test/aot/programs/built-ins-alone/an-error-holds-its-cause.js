const error = new Error("failed", { cause: { code: 1.5 } });
console.log(error.cause.code + 1, error.message.length, "cause" in new Error("plain"), new Error("plain").cause === undefined);
