// The name of console.write, and how Bun.inspect prints the function.
console.log(Bun.inspect(console.write), JSON.stringify(console.write.name));
