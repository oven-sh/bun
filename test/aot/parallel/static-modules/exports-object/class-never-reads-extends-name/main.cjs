// k.cjs exports three classes and only one is read. An unread one still runs its `extends`, which reads a name of x.cjs that nothing else reads, and its constructor makes the third, which nothing else names.
const k = require("./k.cjs");
console.log(typeof k.Read, new k.Read().who());
