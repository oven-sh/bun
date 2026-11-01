// process.execArgv is changed under another name, then overwritten through a key that the program puts together.
function attempt(read) {
  try {
    return String(read());
  } catch (error) {
    return error.constructor.name;
  }
}
function length() {
  return process.execArgv.length;
}
function first() {
  return typeof process.execArgv[0];
}
function hasFlag(flag) {
  return process.execArgv.includes(flag);
}
const other = { list: process.execArgv };
const seen = [];
for (let i = 0; i < 9; i++) {
  if (i === 3) other.list.push(4, "--added");
  if (i === 6) process[["exec", "Argv"].join("")] = 1.5;
  seen.push([attempt(length), attempt(first), attempt(() => hasFlag("--added")), typeof process.execArgv, Array.isArray(process.execArgv)].join(" "));
}
console.log(seen.join("\n"));
