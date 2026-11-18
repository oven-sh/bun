const unseen = x => [x][JSON.parse("0")];
unseen(process.nextTick)(name => console.log("ticked", name), "once");
console.log("first");
