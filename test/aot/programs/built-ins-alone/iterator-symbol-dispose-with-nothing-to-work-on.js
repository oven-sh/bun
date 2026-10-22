const subject = [].values();
const result = subject[Symbol.dispose]();
console.log(typeof result, result === undefined);
