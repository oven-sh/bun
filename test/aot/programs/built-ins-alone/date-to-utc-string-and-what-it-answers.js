const date = new Date(86400000.5);
const result = date.toUTCString();
console.log(typeof result, result.length, result);
