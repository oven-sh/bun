const kind = process.argv.length;
try {
  throw new TypeError(`constructor${kind} is not allowed`);
} catch (e) {
  console.log(e.message);
}
