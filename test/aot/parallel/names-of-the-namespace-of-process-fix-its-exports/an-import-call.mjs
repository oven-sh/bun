import process from "node:process";
const namespace = await import("node:process");
for (const name in namespace) if (name === "title") console.log("listed");
process.title = 5;
process.features = 3;
process.exitCode = 0;
console.log(typeof namespace.title, typeof namespace.features, typeof namespace.exitCode);
