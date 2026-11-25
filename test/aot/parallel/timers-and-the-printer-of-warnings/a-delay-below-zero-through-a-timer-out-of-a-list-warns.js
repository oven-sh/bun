const unseen = x => [x][JSON.parse("0")];
process.on("warning", warning => console.log("heard", warning.name));
setTimeout(() => console.log("rang first"), 1);
const found = unseen(setTimeout);
found(() => console.log("rang second"), -1);
