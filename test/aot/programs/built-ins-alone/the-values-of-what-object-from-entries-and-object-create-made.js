console.log(Object.values(Object.fromEntries([["a", 1.5]]))[0]);
for (const each of Object.values(Object.fromEntries([["a", 1.5], ["b", "text"]]))) console.log(typeof each, each);
console.log(Object.values(Object.create(null, { a: { value: 2.5, enumerable: true } }))[0]);
