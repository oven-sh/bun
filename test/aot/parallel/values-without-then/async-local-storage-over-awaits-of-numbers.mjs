// AsyncLocalStorage is read behind awaits of numbers in a loop, in two runs that take turns
import { AsyncLocalStorage } from "node:async_hooks";
const log = [];
const storage = new AsyncLocalStorage();
async function count(turns) {
    let text = "";
    for (let i = 0; i < turns; i++) {
        await i;
        text += storage.getStore() + i + ";";
    }
    return text;
}
function deed(name, turns) {
    return storage.run(name, () => count(turns));
}
log.push(await deed("alone", 3));
const both = [deed("a", 3), deed("b", 3), count(2)];
for (let i = 0; i < both.length; i++)
    log.push(await both[i]);
console.log(log.join("\n"));
