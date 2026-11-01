if ([1, 0][1]) console.log(__filename);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared56 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("filename-behind-the-member", typeOfThis(), storeToUndeclaredName());
