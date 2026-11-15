function sum(b) { let s = 0; for (let i = 0; i < b.length; i++) s = (s + (b[i] | 0)) | 0; return s; }
class Short extends Buffer { get length() { return 2; } }
class Plain extends Buffer {}
const plain = Buffer.alloc(4, 5), short = Buffer.alloc(4, 5), below = Buffer.alloc(4, 5);
let told = ""; for (let round = 0; round < 6; round++) told += sum(plain) + " ";
Object.setPrototypeOf(short, Short.prototype); Object.setPrototypeOf(below, Plain.prototype);
told += sum(short) + " " + sum(below) + " " + sum(plain) + " " + sum(new Uint8Array(3).fill(2));
console.log(told);
