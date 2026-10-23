// The checker narrows in an inferred file too.
function f(x) {
  if (typeof x === "string") {
    x;
  } else {
    x;
  }
}
