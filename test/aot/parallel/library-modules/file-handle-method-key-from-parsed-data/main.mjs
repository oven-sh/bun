import { open } from "node:fs/promises";
const box = JSON.parse('{"name":"readLines"}');
box.handle = await open("lines.txt");
console.log(typeof box.handle[box.name], box.handle[box.name].name);
try {
  box.handle[box.name]();
} catch (error) {
  console.log(error.message.split(". ")[0]);
}
await box.handle.close();

/* Output:
function readLines
'readLines' was not compiled into this executable because your code never calls it
*/
