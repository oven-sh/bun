class Other extends Promise {}
const table = {};
const key = JSON.parse("\"a\"");
table[key] = () => 1;
const made = Other.resolve(7);
made.then(value => console.log(made instanceof Other, value + 1, table));
