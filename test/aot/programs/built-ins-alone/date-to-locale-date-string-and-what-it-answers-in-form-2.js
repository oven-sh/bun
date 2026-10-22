const date = new Date(86400000.5);
const result = date.toLocaleDateString("an", 2.5);
console.log(typeof result);
