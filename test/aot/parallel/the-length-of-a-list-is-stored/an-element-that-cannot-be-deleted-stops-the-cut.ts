const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function store(list: number[], to: number): string { try { list.length = to >>> 0; return "stored " + list.length; } catch (error) { return (error as Error).constructor.name + " " + list.length; } }
const pinned = [1, 2, 3, 4, 5]; Object.defineProperty(pinned, 2, { configurable: false, value: 3, writable: true, enumerable: true });
console.log(store(pinned, numbers[1]!), pinned.join(), store(pinned, numbers[4]!), store(pinned, numbers[3]!));
