const numbers = JSON.parse("[0,1,2,3,4,5]");
function store(list, to) { list.length = to >>> 0; return list.length; }
const frozen = [1, 2, 3]; Object.freeze(frozen);
const fixed = [1, 2, 3]; Object.defineProperty(fixed, "length", { writable: false });
const pinned = [1, 2, 3, 4]; Object.defineProperty(pinned, 1, { configurable: false });
console.log(store(frozen, numbers[3]), store(frozen, numbers[1]), store(fixed, numbers[0]), store(pinned, numbers[0]), store([1, 2, 3], numbers[1]), store([1, 2, 3], numbers[3]));
