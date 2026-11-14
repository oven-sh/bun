// Without the DOM's library the types of Bun say what a form hands out: a value is a text or a file, and a form is walked as it is. The error would be
// "The left-hand side of an 'instanceof' expression must be of type 'any', an object type or a type parameter."
export {};
const form = new FormData();
form.append("note", "hello");
form.append("upload", new File(["abc"], "a.txt"));
for (const [name, value] of form.entries()) console.log(name, value instanceof File ? value.name : value.toUpperCase());
for (const value of form.values()) console.log(typeof value === "string" ? value.length : value.size);
for (const [name, value] of form) console.log(name, typeof value);
for (const name of form.keys()) console.log(name.toUpperCase());
