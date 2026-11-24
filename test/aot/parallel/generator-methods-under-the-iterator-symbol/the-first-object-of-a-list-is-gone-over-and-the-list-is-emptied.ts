// A generator method under the iterator symbol: the first object of a list is gone over and the list is emptied.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Bag { constructor(private a: number[]) {} *[Symbol.iterator]() { for (const x of this.a) yield x; } }
const bags: Bag[] = [new Bag([1, 2, 3])];
function sum(): string { try { let s = 0; for (const x of bags[0]) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
function listed(): string { try { return [...bags[0]].join(); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
console.log(sum(), listed()); bags.pop(); console.log(sum(), listed());
