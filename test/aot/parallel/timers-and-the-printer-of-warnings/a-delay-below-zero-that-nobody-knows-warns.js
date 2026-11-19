const unseen = x => [x][JSON.parse("0")];
process.on("warning", warning => console.log("heard", warning.name, warning.message));
setTimeout(() => console.log("rang"), unseen(-5));
