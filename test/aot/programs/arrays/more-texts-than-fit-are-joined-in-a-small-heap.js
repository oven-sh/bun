// One call of join or of toLocaleString walks a list that is no array and makes an object for each of its elements, more than fit: it ends in a RangeError. Plain Bun has no limit.
function attempt(what, make) {
  try {
    console.log(what, "finished", make().length);
  } catch (error) {
    console.log(what, error.name);
  }
}
const bytes = new Uint8Array(2 ** 22);
const sparse = [];
sparse[2 ** 22] = "x";
attempt("holes in front of an element", () => sparse.join(","));
attempt("bytes", () => Array.prototype.join.call(bytes, ","));
attempt("bytes once more", () => Array.prototype.join.call(bytes, ","));
attempt("bytes by toLocaleString", () => Array.prototype.toLocaleString.call(bytes));
attempt("a few bytes afterward", () => Array.prototype.join.call(bytes.subarray(0, 1000), ","));
attempt("holes afterward", () => sparse.join("ab"));
