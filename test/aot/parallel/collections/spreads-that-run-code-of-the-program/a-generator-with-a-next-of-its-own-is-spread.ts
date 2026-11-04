function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
const own = upTo(3); let turns = 0;
(own as any).next = function () { return turns++ < 2 ? { done: false, value: "own " + turns } : { done: true, value: undefined }; };
console.log([...own].join());
const other = upTo(3);
(other as any)[Symbol.iterator] = function () { return [7, 8][Symbol.iterator](); };
console.log([...other].join());
const below = upTo(3);
Object.setPrototypeOf(below, { [Symbol.iterator]() { return ["from another prototype"][Symbol.iterator](); } });
console.log([...below].join());
