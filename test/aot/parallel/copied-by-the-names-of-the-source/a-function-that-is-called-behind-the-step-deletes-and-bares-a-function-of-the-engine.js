function drop(source) {
  delete source.fromEntries;
}
function read(source) {
  let found;
  for (const key in source) {
    drop(source);
    found = source[key];
  }
  return found;
}
function Made() {}
Object.setPrototypeOf(Made, Object);
Made.fromEntries = 1;
const found = read([JSON.parse("{}"), Made][1]);
console.log(typeof found === "function" ? JSON.stringify(found([["made", "up"]])) : `${found}`);
