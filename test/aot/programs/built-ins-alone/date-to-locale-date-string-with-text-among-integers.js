const date = new Date(86400000.5);
const result = date.toLocaleDateString(1.5, "text");
console.log(typeof result);
