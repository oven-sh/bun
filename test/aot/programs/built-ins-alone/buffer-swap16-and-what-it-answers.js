const subject = Buffer.from("banana and more text, 24");
const result = subject.swap16();
console.log(result === subject, subject instanceof Buffer, subject.length, typeof subject[0], subject[0] + 1);
console.log(typeof subject[1], subject[1] + 1);
