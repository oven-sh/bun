const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.username = "an";
console.log(typeof subject.username, subject.username.length, subject.username);
