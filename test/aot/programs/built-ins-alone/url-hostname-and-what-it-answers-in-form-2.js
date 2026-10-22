const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.hostname = "an";
console.log(typeof subject.hostname, subject.hostname.length, subject.hostname);
