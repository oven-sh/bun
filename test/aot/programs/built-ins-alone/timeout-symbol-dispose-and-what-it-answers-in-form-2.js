const subject = setTimeout(() => {}, 0);
const result = subject[Symbol.dispose]("an", "an");
console.log(typeof result, result === undefined);
