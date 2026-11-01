[module, ...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([...([] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])] ? [0] : [])];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared165 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-of-spreads-of-selected-lists-24-deep", typeOfThis(), storeToUndeclaredName());
