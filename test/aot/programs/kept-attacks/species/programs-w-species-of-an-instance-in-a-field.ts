// The instance sits in a field of an object that a callback of the library hands back.
const log: string[] = [];
class Mine extends Array<number> { static get [Symbol.species](): any { log.push("getter"); return Array; } }
const holders = [{ list: new Mine() }];
holders[0].list.push(1);
setTimeout((holder: { list: number[] }) => { log.push(String(holder.list.map(one => one).length)); console.log(log.join("; ")); }, 1, holders[0]);
