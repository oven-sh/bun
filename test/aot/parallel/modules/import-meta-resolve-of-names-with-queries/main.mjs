// The URL of a name with a query has the query behind the file, as it is written.
const late = process.argv.length > 20;
const last = url => url.split("/").pop();

console.log(last(import.meta.resolve("#dock?q")), last(import.meta.resolve("@made-up/harbor/crane?a=1&b=2")));
console.log(last(import.meta.resolve(late ? "#dock" : "#dock?tide")), last(import.meta.resolve(late ? "fs" : "@made-up/harbor/crane?")));
console.log(last(import.meta.resolve("#dock")), last(import.meta.resolve("./dock.mjs?q")));
const { name } = await import("#dock?q");
console.log(name, last(import.meta.resolve("#dock?q")));
for (const query of ["", "?one", "?two"]) console.log(last(import.meta.resolve("@made-up/harbor/crane" + query)));
