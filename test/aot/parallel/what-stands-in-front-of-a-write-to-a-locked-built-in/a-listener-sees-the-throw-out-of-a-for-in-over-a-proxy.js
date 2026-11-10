// A listener sees the throw out of the for-in: the write behind it is never reached, and the program ends well.
process.on("uncaughtException", error => { console.log("seen", error.constructor.name); });
const watched = new Proxy({}, { ownKeys() { return 1; } });
for (const name in watched) { }
Object.keys = function () { return []; };
console.log("came to the write");
