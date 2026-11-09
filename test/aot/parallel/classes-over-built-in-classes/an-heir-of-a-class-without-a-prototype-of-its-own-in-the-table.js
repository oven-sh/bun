class Named extends File {}
const named = new Named(["a"], "a.txt");
console.log(named.name, named.size, named instanceof File, named instanceof Blob, Object.getPrototypeOf(Named) === File);
