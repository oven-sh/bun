class Base { static limit = 7; static make(): string { return "base makes"; } own = 1; greet(): string { return "base greets"; } }
const Parent: typeof Base = JSON.parse("false") ? Base : null!;
function ask(name: string, f: () => unknown): void { try { console.log(name, f()); } catch (error) { console.log(name, (error as Error).name); } }
class Child extends Parent {}
ask("make", () => Child.make());
export {};
