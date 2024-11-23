import * as readline from "node:readline/promises";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

await rl.question("What is your age?\n").then(answer => {
  console.log("Your age is: " + answer);
});
