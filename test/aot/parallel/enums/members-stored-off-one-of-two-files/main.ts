// Which of two files is loaded is known when the program runs: each one's enum is handed on, and a store under a member's name may go to it.
import { read } from "./reader";
const loaded: any = await import(process.argv.length > 9 ? "./other.ts" : "./color.ts");
console.log(read());
loaded.Color.Red = "stored";
console.log(read());
for (const value of Object.values(loaded) as any[]) value.Blue = "too";
console.log(read());
