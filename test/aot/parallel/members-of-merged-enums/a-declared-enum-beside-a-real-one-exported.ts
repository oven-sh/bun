export declare enum Mode { Off, Fast }
export enum Mode { Slow = 2 }
const table = { [Mode.Slow]: "slow", [String(Mode.Fast)]: "fast" };
console.log(Object.keys(table).join(), Mode.Fast === 1 ? "folded" : "read at run time", typeof Mode.Fast);
