// Two allocations have the layout of B: the one of First stores `first`, which nothing reads, and the one the super call makes for A never has it and lists its keys.
function A() { this.x = 1; let names = ""; for (const k in this) names += k + ","; this.names = names; }
class First { constructor() { this.first = "First"; } }
class B extends First {}
Object.setPrototypeOf(B, A);
console.log(new B().names);
