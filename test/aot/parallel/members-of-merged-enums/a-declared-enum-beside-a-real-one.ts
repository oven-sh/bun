declare enum Mode { Off, Fast }
enum Mode { Slow = 2 }
if (Mode.Fast === 1) console.log("folded");
else console.log("read at run time");
console.log(Mode.Fast === undefined ? "no such member" : "a member");
console.log(String(Mode.Fast), Mode.Slow);
