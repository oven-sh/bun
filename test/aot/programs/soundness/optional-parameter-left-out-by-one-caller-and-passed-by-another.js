function nothing() {}
function describe(value, depth = 0) {
  try {
    return missing ? describe(other, depth) : "accessor";
  } catch (error) {
    return "caught " + depth;
  }
}
console.log(describe(nothing()));
