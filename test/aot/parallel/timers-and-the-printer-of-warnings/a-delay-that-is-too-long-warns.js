process.on("warning", warning => console.log("heard", warning.name, warning.message));
const bell = setTimeout(() => console.log("rang"), 2 ** 31);
console.log(typeof bell);
