// The type of an import() that the run makes may be "file": the module holds the name of the file, whatever else the file is.
const made = type => ({ with: { type: String(type) } });
const show = (label, module) => console.log(label, typeof module.default, module.value);
show("json", await import("./a.json", made("json")));
show("json as file", await import("./a.json", made("file")));
show("text as file", await import("./b.txt", made("file")));
show("code as file", await import("./part.mjs", made("file")));
console.log((await import("./a.json", made("json"))).default.x);
