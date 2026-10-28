// The state of a writable stream holds a bound function in a field that the library declares with a function type, stored once for every stream.
// A thousand streams take no field out of its slot: what is counted is what the start of the program counts. The output is that of plain Bun.
// COUNTER: FieldsLeftSlotByStoreOfOtherType <= 50
import { Writable } from "node:stream";
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Writable({ write(chunk, encoding, callback) { callback(); } }).writableLength + 1;
console.log(sum);
