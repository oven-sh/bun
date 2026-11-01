// The own keys of built-in objects behind a warning that is printed. An object lists a member from when it is first read, and what makes
// process.stderr reads some. The program never names process.stderr. The copy adds all that nobody has read yet.
process.emitWarning("a warning");
await new Promise(resolve => setImmediate(resolve));
function show(name, holder) {
  Object.entries(holder);
  console.log(name, Reflect.ownKeys(holder).map(String).join());
}
show("Object", Object);
show("Reflect", Reflect);
show("Symbol", Symbol);
show("Number", Number);
show("Promise.prototype", Promise.prototype);
show("Array", Array);
show("Buffer", Buffer);
show("JSON", JSON);
show("String", String);
show("Promise", Promise);
show("Date", Date);
show("Date.prototype", Date.prototype);
show("Number.prototype", Number.prototype);
show("Error.prototype", Error.prototype);
