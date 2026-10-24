// One odd line that never runs stands beside a program that does not change. It prints what plain Bun prints.
class A { toString() { return "a"; } }
console.log(new A().toLocaleString());
