const held = await import("node:process");
console.log(Object.keys(held).length > 3);
process.exit(0);
