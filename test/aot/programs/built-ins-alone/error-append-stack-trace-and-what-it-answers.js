const first = new Error("message");
const second = new Error("message");
const result = Error.appendStackTrace(first, second);
console.log(typeof result, result === undefined, first instanceof Error, first.message);
console.log(second instanceof Error, second.message);
