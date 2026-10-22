const date = new Date(86400000.5);
const result = date.toJSON(1.5);
console.log(typeof result, result.length, result);
