const subject = new URLSearchParams();
const result = subject.append("an", "-");
console.log(typeof result, result === undefined, subject instanceof URLSearchParams, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
