class NotFound extends Error {
  constructor(what) {
    super(what + " was not found");
    this.name = "NotFound";
    this.what = what;
  }
}
function sought(table, key) {
  if (!(key in table)) throw new NotFound(key);
  return table[key];
}
function answered(key) {
  try {
    return sought({ a: 1 }, key);
  } catch (error) {
    if (error instanceof NotFound) return error.name + ":" + error.what;
    throw error;
  }
}
console.log(answered("a"), answered("b"));
