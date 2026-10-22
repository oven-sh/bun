const subject = Buffer.from("banana and more text, 24");
const result = subject.writeUInt32LE(1.5, 2);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1);
