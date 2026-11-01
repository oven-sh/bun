// Alone: beside other programs this one gets what they name.
// node:fs makes `promises` when somebody asks for it, and here no code that the compiler can follow asks. Text that nobody can read gets a stand-in. What was left out is an object that
// the program has under another name, so a write to the stand-in would never arrive there: it is refused as a call is. A name never throws, and an object below the stand-in takes a store itself.
import promises from "node:fs/promises";
import { existsSync } from "node:fs";

const hidden = text => text.split("~").join(process.argv.length > 99 ? "?" : "");
const tell = text => {
  try {
    return String(Function(hidden(text))());
  } catch (error) {
    return error.message.split(" because ")[0];
  }
};
const standIn = 'pro~cess.getBuil~tinModule("f~s").promises';
console.log(existsSync(process.execPath), tell(`return typeof ${standIn}`));
for (const write of [
  `${standIn}.access = () => "mine"`,
  `${standIn}.added = 1`,
  `${standIn}[0] = 1`,
  `Object.defineProperty(${standIn}, "access", { value: 1 })`,
  `delete ${standIn}.access`,
  `Object.setPrototypeOf(${standIn}, null)`,
  `Object.freeze(${standIn})`,
])
  console.log(tell(write));
console.log(
  tell(`const below = Object.create(${standIn}); below.a = 1; return below.a`),
  tell(`return ${standIn}.access`),
);
console.log(typeof promises.access("/").then);
/* Output:
true function
'promises' was not compiled into this executable
'promises' was not compiled into this executable
'promises' was not compiled into this executable
'promises' was not compiled into this executable
'promises' was not compiled into this executable
'promises' was not compiled into this executable
'promises' was not compiled into this executable
1 undefined
function
*/
