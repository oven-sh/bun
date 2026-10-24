// Functions that `switch` on the length of their rest parameter and read its elements by constant index.
// IR= 0 ofAny CreateRest
// IR= 0 ofNumbers CreateRest
// IR= 2 ofAny GetRestLength
// IR= 3 ofAny GetArgument
// IR= 3 ofNumbers GetArgument
declare const console: any;
function cold(args: unknown[]): number { return args.length; }
function ofAny(...args: any[]): number { switch (args.length) { case 0: return 0; case 1: return args[0]; case 2: return args[0] + args[1]; default: return cold(args); } }
function ofNumbers(...args: number[]): number { switch (args.length) { case 0: return 0; case 1: return args[0]; case 2: return args[0] + args[1]; default: return cold(args); } }
const table: any[] = [ofAny, ofNumbers];
let n = 0;
for (let i = 0; i < 5_000_000; i++) n += table[i & 1](1) + table[i & 1](1, 2);
console.log(n);
export {};
