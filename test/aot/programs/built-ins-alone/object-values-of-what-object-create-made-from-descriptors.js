const list = Object.values(Object.create(null, { a: { value: 1.5, enumerable: true } }));
console.log(list.length, list[0], typeof list[0]);
