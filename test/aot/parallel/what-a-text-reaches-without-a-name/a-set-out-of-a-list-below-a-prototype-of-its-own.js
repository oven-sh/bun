// A list that hangs below an object of its own is off the quick road of the native: the protocol runs.
const list = [4, 2, 4];
Object.setPrototypeOf(list, Object.create(Object.getPrototypeOf(list)));
console.log(new Set(list).size);
