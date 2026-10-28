const pattern = new RegExp(/a/);
Object.defineProperty(pattern, "lastIndex", { value: "text", writable: false });
console.log(pattern.lastIndex, Object.getOwnPropertyDescriptor(pattern, "lastIndex").writable);
