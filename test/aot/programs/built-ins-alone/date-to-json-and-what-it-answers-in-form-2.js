const date = new Date(86400000.5);
const result = date.toJSON("an");
console.log(typeof result, result.length, result);
