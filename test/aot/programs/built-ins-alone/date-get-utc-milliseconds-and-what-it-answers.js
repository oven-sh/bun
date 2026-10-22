const date = new Date(86400000.5);
const result = date.getUTCMilliseconds();
console.log(typeof result, result + 1, 1 / result);
