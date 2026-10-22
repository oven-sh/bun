process.on("exit", code => console.log("exit", code + 1));
process.exit(0);
console.log("never printed");
