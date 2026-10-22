const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
subject.name = "text";
console.log(typeof subject.name, subject.name.length, subject.name);
