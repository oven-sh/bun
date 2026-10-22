const subject = setImmediate(() => {});
const result = subject[Symbol.dispose]("text", 1.5);
console.log(typeof result, result === undefined);
