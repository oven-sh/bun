function check(kind) {
  if (kind !== "a") throw new TypeError(`constructor${kind} is not allowed`);
  return kind;
}
try {
  check("b");
} catch (error) {
  console.log(error.message);
}
