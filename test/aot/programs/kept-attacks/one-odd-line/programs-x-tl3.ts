// One odd line: programs x. It prints what plain Bun prints.
class A { toString() { return "a"; } }
console.log(new A().toLocaleString());
