const subject = setImmediate(() => {});
const result = subject[Symbol.dispose](1.5, "an");
console.log(typeof result, result === undefined);
