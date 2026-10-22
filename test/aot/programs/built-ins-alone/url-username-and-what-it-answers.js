const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
const result = subject.username;
console.log(typeof result, result.length, result);
