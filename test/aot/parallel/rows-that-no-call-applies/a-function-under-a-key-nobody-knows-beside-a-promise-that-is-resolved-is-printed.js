const table = {};
const key = JSON.parse("\"a\"");
table[key] = () => 1;
Promise.resolve(1).then(value => console.log(value + 1));
console.log(table, Object.keys(table).length);
