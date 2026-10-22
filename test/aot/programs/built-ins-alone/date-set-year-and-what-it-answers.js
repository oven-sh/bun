const date = new Date(86400000.5);
const result = date.setYear(1.5);
console.log(typeof result, result + 1, date instanceof Date, date.getTime());
