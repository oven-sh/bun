const date = new Date(86400000.5);
const result = date.setUTCDate(1.5);
console.log(typeof result, result + 1, 1 / result, date instanceof Date, date.getTime());
