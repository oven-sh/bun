// Typed classes below Object: fields, methods, a subclass, and lists of both. The build verifies the program after every stage.
// Flags: --aot-check=verify-each-stage
// Env of the executable: BUN_JSC_validateAOTRuntime=1
class A extends Object { n = 1; self: () => A; constructor() { super(); this.self = () => this; } grow(): this { this.n++; return this; } }
class B extends A { extra = "b"; grow(): this { super.grow(); this.n += 10; return this; } }
function sum(list: A[]): number { let total = 0; for (const each of list) total += each.n; return total; }
function name(x: A | string): string { return x instanceof A ? "A" + x.n : x; }
const many: A[] = []; for (let i = 0; i < 1000; i++) many.push(i & 1 ? new A() : new B().grow());
console.log(sum(many), many[0].self() === many[0], name(many[1]), name("s"), Object.keys(many[0]).join(), JSON.stringify(many[1]), (many[0] as B).extra);
