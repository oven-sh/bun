function own() { return "own"; }
process.removeListener = own;
process.off = own;
console.log(process.removeListener(), process.off(), process.listenerCount("made-up"));
