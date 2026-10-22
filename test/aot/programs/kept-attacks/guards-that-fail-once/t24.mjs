// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Model {}
class User extends Model {}
class Admin extends User { static displayName = "admin"; }
const rounds = Number(process.argv[2]);
const variant = process.argv[3];
Model["table" + "Name".slice(0, process.argv.length)] = "models";
const types = [Model, User, Admin];
const keys = ["tableName", "defaultProps", "displayName"];
function byValue(type, key) { return type[key] === undefined ? 0 : 1; }
function presence(type) { return ("tableName" in type ? 1 : 0) + ("defaultProps" in type ? 1 : 0); }
function presenceByValue(type, key) { return key in type ? 1 : 0; }
function own(type) { return (Object.hasOwn(type, "tableName") ? 1 : 0) + (type.hasOwnProperty("displayName") ? 1 : 0); }
function call(type) { return typeof type.create === "function" ? type.create() : 0; }
let sum = 0;
for (let round = 0; round < rounds; round++) {
  const type = types[round % 3];
  if (variant === "byValue") sum += byValue(type, keys[(round >> 2) % 3]);
  else if (variant === "presence") sum += presence(type);
  else if (variant === "presenceByValue") sum += presenceByValue(type, keys[(round >> 2) % 3]);
  else if (variant === "own") sum += own(type);
  else sum += call(type);
}
console.log(sum);
