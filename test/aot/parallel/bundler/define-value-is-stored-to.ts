// A store to a defined name whose `--define` value is one name stores to the `let` of the file that has that name.
// Flags: --define NAME=target
declare let NAME: number;
let target = 0;
NAME = 1;
console.log(target);
export {};
