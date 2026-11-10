function Other(executor) { executor(value => { this.value = value; }, () => {}); }
const table = {};
const key = JSON.parse("\"a\"");
table[key] = () => 1;
const made = Promise.resolve.call(Other, 7);
console.log(made instanceof Other, made.value + 1, table);
