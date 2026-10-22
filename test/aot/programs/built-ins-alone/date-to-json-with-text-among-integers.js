const date = new Date(86400000.5);
const result = date.toJSON("text");
console.log(typeof result, result.length, result);
