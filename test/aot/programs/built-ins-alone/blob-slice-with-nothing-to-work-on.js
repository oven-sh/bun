const subject = new Blob([]);
const result = subject.slice(1.5, 2.5, 3.5);
console.log(result instanceof Blob, Object.keys(result).join());
