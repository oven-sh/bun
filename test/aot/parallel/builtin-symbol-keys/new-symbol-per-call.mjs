// Each call makes another symbol, so the key is not one known symbol.
function mark(holder) {
  const key = Symbol("made up");
  holder[key] = 1;
  return holder[key];
}
console.log(mark(globalThis), mark(globalThis), Object.getOwnPropertySymbols(globalThis).filter(s => s.description === "made up").length);
