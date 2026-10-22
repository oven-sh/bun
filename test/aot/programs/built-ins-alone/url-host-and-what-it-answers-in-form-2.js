const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.host = "an";
console.log(typeof subject.host, subject.host.length, subject.host);
