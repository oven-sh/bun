const subject = [].values();
const result = subject[Symbol.iterator]();
console.log(result === subject);
