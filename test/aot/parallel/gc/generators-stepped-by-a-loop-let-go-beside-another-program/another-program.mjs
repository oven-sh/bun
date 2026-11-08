// Never started: it is the second entry point of ./main.ts. As the program that stood here before it, it holds a direct eval.
const held = 1;
console.log(eval("held + 1"));
