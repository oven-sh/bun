// Code evaluated at run time names the standard streams in a program whose own text never does.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const texts = [
  "typeof process.std@out", "typeof process.std@err", "typeof process.std@in", "typeof process.std@out.write", "typeof process.std@err.write",
  "process.std@out.fd", "process.std@err.fd", "process.std@in.fd", "typeof process.std@out.isTTY", "typeof process.std@in.isTTY", "typeof process.std@out.columns", "typeof process.std@err.rows",
  "process.std@out.write('one\\n')", "process.std@out.write('two\\n', 'utf8')", "process.std@err.write('')", "process.std@out === process.std@out", "process.std@out === process.std@err",
  "process.std@out.write.name", "process.std@out.write.length", "process.std@out.write === process.std@err.write",
  "process.std@out.write('three\\n', error => console.log('called with', error))", "process.std@out.write('four\\n', 'utf8', error => console.log('called with', error))",
  "(0, process.std@out.write)('x')", "process.std@out.write.call(null, 'x')", "process.std@out.write.call({}, 'x')", "process.std@out.write.call({ fd: 1 }, 'x')",
  "process.std@out.write(new Uint8Array([102, 105, 118, 101, 10]))",
];
for (const text of texts) {
  const source = "return " + join(...text.split("@"));
  try { console.log(text, "=>", new Function(source)()); } catch (error) { console.log(text, "threw", error.constructor.name, String(error.message).slice(0, 70)); }
}
console.log((0, eval)(join("typeof process.std", "out.write")));
