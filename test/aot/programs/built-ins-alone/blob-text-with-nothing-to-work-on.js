const subject = new Blob([]);
const result = subject.text();
const settled = await result;
console.log(typeof settled, settled.length, settled);
