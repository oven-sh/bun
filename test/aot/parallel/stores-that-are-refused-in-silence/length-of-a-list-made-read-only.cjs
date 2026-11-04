const list = [1, 2];
Object.defineProperty(list, "length", { writable: false });
list[5] = 1; list.length = 0;
console.log(list[5], list.length);
