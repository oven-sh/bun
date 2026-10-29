// In a program whose own text names no standard stream, code evaluated at run time gets an object that answers a few members.
// Every question about another name and every change throw the error that says what was left out of the executable. Plain Bun answers all of them.
const join = (...parts) => parts.join(process.argv.length > 99 ? "x" : "");
const texts = [
  "typeof process.std@out", "process.std@out.writable", "process.std@out.on", "process.std@err.end", "process.std@out.extra = 1", "delete process.std@err.fd",
  "Object.defineProperty(process.std@out, 'fd', { value: 3 })", "typeof process.std@in", "process.std@in.on", "process.std@in.write",
  "'write' in process.std@err", "'on' in process.std@out", "Object.hasOwn(process.std@out, 'fd')", "Object.hasOwn(process.std@in, '_type')", "Reflect.has(process.std@err, 'end')",
];
for (const text of texts) {
  const source = "return " + join(...text.split("@"));
  try { console.log(text, "=>", new Function(source)()); } catch (error) { console.log(text, "threw", error.constructor.name, /was not compiled into this executable/.test(error.message)); }
}
/* Output:
typeof process.std@out => object
process.std@out.writable threw Error true
process.std@out.on threw Error true
process.std@err.end threw Error true
process.std@out.extra = 1 threw Error true
delete process.std@err.fd threw Error true
Object.defineProperty(process.std@out, 'fd', { value: 3 }) threw Error true
typeof process.std@in => object
process.std@in.on threw Error true
process.std@in.write threw Error true
'write' in process.std@err => true
'on' in process.std@out threw Error true
Object.hasOwn(process.std@out, 'fd') => true
Object.hasOwn(process.std@in, '_type') threw Error true
Reflect.has(process.std@err, 'end') threw Error true
*/
