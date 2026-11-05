let count = 0;
for (const name in process.versions) count += typeof process.versions[name] === "string" ? 1 : 0;
console.log(count > 3);
