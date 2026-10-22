const subject = new Blob([]);
const result = subject.exists();
const settled = await result;
console.log(typeof settled, settled);
