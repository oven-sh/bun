const source = { label: "two" };
source.console = { log: text => process.stdout.write("mine: " + text + "\n") };
Object.assign(globalThis, source);
console.log("said");
