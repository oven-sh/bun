const subject = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
subject.search = "an";
console.log(typeof subject.search, subject.search.length, subject.search);
