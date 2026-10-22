const subject = setImmediate(() => {});
const result = subject._destroyed;
console.log(typeof result);
