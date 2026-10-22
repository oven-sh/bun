const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.protocol = "an";
console.log(typeof subject.protocol, subject.protocol.length, subject.protocol);
