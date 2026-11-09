const word = JSON.parse('"sql"');
const found = Object.getOwnPropertyDescriptor(Bun, word);
console.log(typeof found, found && typeof found.value);
console.log("end");
