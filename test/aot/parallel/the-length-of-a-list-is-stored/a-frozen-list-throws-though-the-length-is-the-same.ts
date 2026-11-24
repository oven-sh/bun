const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function store(list: number[], to: number): string { try { list.length = to >>> 0; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
const frozen = [1, 2, 3]; Object.freeze(frozen);
const sealed = [1, 2, 3]; Object.seal(sealed);
const fixed = [1, 2, 3]; Object.defineProperty(fixed, "length", { writable: false });
const closed = [1, 2, 3]; Object.preventExtensions(closed);
console.log(store(frozen, numbers[3]!), store(frozen, numbers[1]!), store(sealed, numbers[3]!), store(sealed, numbers[1]!), store(sealed, numbers[5]!));
console.log(store(fixed, numbers[3]!), store(fixed, numbers[2]!), store(fixed, numbers[4]!), store(closed, numbers[3]!), store(closed, numbers[1]!), store(closed, numbers[5]!));
