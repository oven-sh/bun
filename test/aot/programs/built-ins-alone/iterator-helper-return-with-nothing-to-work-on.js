const subject = [].values().map(value => value);
const result = subject.return();
console.log(typeof result, Object.keys(result).join(), typeof result.value, result.value === undefined);
console.log(typeof result.done, result.done);
