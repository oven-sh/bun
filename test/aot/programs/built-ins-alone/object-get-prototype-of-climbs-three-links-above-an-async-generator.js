async function* numbers() {}
const AsyncIteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(numbers())));
const own = Object.create(AsyncIteratorPrototype);
console.log(typeof own[Symbol.asyncIterator], own[Symbol.asyncIterator]() === own);
