const subject = new Blob([]);
const result = subject.formData();
const settled = await result;
console.log(typeof settled, Object.keys(settled).join());
const items2 = [...settled];
console.log(Array.isArray(items2), items2.length);
