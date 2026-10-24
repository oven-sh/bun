// Assorted, one probe of many. It prints what plain Bun prints.
class A { toString(): string { return "a"; } }
class B { toLocaleString(): string { return "b"; } }
class C { toString(): string { return "c"; } }
class D { valueOf(): number { return 4; } }
const show = (run: () => unknown): string => { try { return String(run()); } catch (error) { return (error as Error).name + ": " + (error as Error).message.slice(0, 40); } };
console.log(show(() => new A().toLocaleString()));
console.log(show(() => [new B()].toLocaleString()));
console.log(show(() => Object.prototype.toLocaleString.call(new C())));
console.log(show(() => new D().toLocaleString()));
