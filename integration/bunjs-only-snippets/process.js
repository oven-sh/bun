if (process.title !== "bun") throw new Error("process.title is not 'bun'");
if (typeof process.env.USER !== "string")
  throw new Error("process.env is not an object");

if (process.env.USER.length === 0)
  throw new Error("process.env is missing a USER property");

if (process.platform !== "darwin" && process.platform !== "linux")
  throw new Error("process.platform is invalid");

if (!process.isBun) throw new Error("process.isBun is invalid");

console.log(process.argv);
console.log(JSON.stringify(process, null, 2));
