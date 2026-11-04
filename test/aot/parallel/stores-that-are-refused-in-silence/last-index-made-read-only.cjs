const r = /a/g;
Object.defineProperty(r, "lastIndex", { writable: false });
r.lastIndex = 5;
console.log(r.lastIndex);
