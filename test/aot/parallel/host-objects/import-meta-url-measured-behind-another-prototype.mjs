// A function takes the length of import.meta.url unless it is undefined. Between two calls import.meta gets a prototype where url is a number.
function measure() {
  const url = import.meta.url;
  if (url === undefined) return "none";
  return url.length;
}
function join() {
  return import.meta.dir + "/" + import.meta.file;
}
console.log(measure() > 5, typeof join());
Object.setPrototypeOf(import.meta, { url: 5, dir: 1 });
console.log(measure(), join());
Object.setPrototypeOf(import.meta, {});
console.log(measure(), join());
