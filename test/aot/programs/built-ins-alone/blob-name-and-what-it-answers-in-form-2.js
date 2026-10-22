const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
subject.name = 1.5;
console.log(typeof subject.name, subject.name === undefined);
