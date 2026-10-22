const subject = setImmediate(() => {});
const result = subject[Symbol.dispose]("an", "an");
console.log(typeof result, result === undefined);
