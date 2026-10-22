const date = new Date(86400000.5);
const result = date.setHours(1.5, 2.5, 3.5, 4.5);
console.log(typeof result, result + 1, date instanceof Date, date.getTime());
