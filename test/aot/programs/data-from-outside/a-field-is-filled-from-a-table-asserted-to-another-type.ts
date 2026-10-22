interface Table { first: unknown }
interface Other { [key: string]: boolean }
interface Made { flag: boolean }
function make(table: Table, key: string): Made { return { flag: (table as unknown as Other)[key] }; }
const a = make({ first: JSON.parse(process.argv.length > 5 ? "1" : "true") }, "first");
const b = make({ first: JSON.parse(process.argv.length > 5 ? "1" : "\"text\"") }, "first");
console.log(a.flag, typeof a.flag, b.flag, typeof b.flag);
export {};
