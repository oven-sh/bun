const subject = new Blob([]);
subject.name = 1.5;
console.log(typeof subject.name, subject.name === undefined);
