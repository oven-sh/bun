const subject = new Headers();
const result = subject.append(1.5, 2.5);
console.log(typeof result, result === undefined, subject instanceof Headers, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
