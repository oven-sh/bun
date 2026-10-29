// The getter and the setter of process.ppid are taken out of its descriptor and called on an object of the program: the setter defines the property there.
const { get, set } = Object.getOwnPropertyDescriptor(process, "ppid");
const other = { a: 1 };
console.log(typeof get.call(other), Object.keys(other).join());
set.call(other, 5);
console.log(other.ppid, Object.keys(other).join(), get.name, set.name);
console.log(typeof process.ppid, Object.keys(Object.getOwnPropertyDescriptor(process, "ppid")).join());
