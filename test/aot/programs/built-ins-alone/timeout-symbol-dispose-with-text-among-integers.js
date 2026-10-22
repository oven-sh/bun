const subject = setTimeout(() => {}, 0);
const result = subject[Symbol.dispose]("text", 1.5);
console.log(typeof result, result === undefined);
