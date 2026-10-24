function safeCall(f, text) {
  try {
    return f(text);
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(safeCall(eval, "1 + 2"));
