const above = process.emit;
process.emit = function (event, ...rest) {
  if (event === "made-up") console.log("own emit", rest.length);
  return above.call(this, event, ...rest);
};
process.on("made-up", value => console.log("listener", value));
console.log(process.emit("made-up", 7));
console.log(Object.prototype.hasOwnProperty.call(process, "emit"), process.emit === above);
