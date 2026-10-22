const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.password = "an";
console.log(typeof subject.password, subject.password.length, subject.password);
