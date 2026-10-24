// Assorted, one probe of many. It prints what plain Bun prints.
class A { lift = 1; toString(): string { return "a" + this.lift; } }
const a = new A();
const text = a.toLocaleString();
console.log(text);
