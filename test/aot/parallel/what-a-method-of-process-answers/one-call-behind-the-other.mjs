// The usual use of the answer: the next call.
process
  .on("madeUp", word => console.log("first", word))
  .once("madeUp", word => console.log("second", word))
  .prependListener("madeUp", word => console.log("in front", word));
console.log(process.emit("madeUp", "word"), process.listenerCount("madeUp"));
