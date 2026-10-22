const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
