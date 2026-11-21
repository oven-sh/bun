// The URL of a name with a query has the query behind the file, as it is written.
const late = process.argv.length > 20;
const last = url => url.split("/").pop();
console.log(last(import.meta.resolve("#dock?q")), last(import.meta.resolve("#dock?")), last(import.meta.resolve("#dock")));
console.log(last(import.meta.resolve(late ? "#dock" : "#dock?tide")));
