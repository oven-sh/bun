// Assorted, one probe of many. It prints what plain Bun prints.
class A { toString(): string { return "a"; } }
console.log(new A().toLocaleString());
