const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.port = "an";
console.log(typeof subject.port, subject.port.length, subject.port);
