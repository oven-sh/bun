// An array iterator asks the object that it goes over for `length`, whichever of keys, values and entries it hands out. Nothing else in the program reads the length.
function upTo(count) {
  return [...Array.prototype.keys.call({ length: count })];
}
console.log(JSON.stringify(upTo(3)), JSON.stringify(upTo(process.argv.length)));
