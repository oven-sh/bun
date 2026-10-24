// The source is itself the prototype of other objects.
function make(i) { return { a: i, hello() { return "hello " + this.a; } }; }
function copy(s) { return { ...s }; }
let out = "";
for (let i = 0; i < 3; i++) {
  const source = make(i);
  const below = Object.create(source);
  const made = copy(source);
  made.a = "copy";
  source.a = "source";
  out += below.hello() + " " + made.hello() + " " + Object.getPrototypeOf(below).a + "; ";
}
console.log(out);
