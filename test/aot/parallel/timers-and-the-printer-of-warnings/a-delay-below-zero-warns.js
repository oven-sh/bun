// The warning goes to standard error, on the next tick, through the printer of warnings of the library.
process.on("warning", warning => console.log("heard", warning.name, warning.message));
setTimeout(() => console.log("rang"), -1);
