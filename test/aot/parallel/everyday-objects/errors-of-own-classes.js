// Error classes with fields, causes and a name, told apart by instanceof
class AppError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}
class NotFound extends AppError {
  constructor(what) {
    super(what + " not found", 404);
    this.what = what;
  }
}
function find(list, what) {
  try {
    const at = list.indexOf(what);
    if (at < 0) throw new NotFound(what);
    if (at > 1) throw new AppError("too far", at, { cause: what });
    return at;
  } catch (error) {
    if (error instanceof NotFound) return error.name + error.code + error.what;
    return String(error) + error.code + error.cause + (error instanceof Error);
  }
}
console.log(find(["a", "b"], "b"), find([], "x"));
console.log(find(["a", "b", "c"], "c"));
console.log(find(["q"], "q"), find(["q"], "Q"));
