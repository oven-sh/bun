function outer(code) {
  try { throw new Error("first"); } catch (caught) {
    const reader = () => typeof caught;
    eval(code);
    return typeof caught + " " + reader();
  }
}
console.log(outer("caught = 5"), outer(""));
