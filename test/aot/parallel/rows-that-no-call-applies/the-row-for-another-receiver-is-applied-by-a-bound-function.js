function Other(executor) { executor(value => { this.value = value; }, () => {}); }
const table = {};
const key = JSON.parse("\"a\"");
table[key] = () => 1;
const bound = Promise.resolve.bind(Other);
const made = bound(7);
console.log(made instanceof Other, made.value + 1, table);
