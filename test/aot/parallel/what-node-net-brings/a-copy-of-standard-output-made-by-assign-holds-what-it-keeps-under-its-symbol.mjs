const lineOf = text => text.split("\n").filter(line => line.includes("kFs")).map(line => line.trim().slice(0, 24)).join(" | ") || "no line";
const copy = Object.assign({}, process.stdout);
console.log(lineOf(Bun.inspect(copy, { depth: +(process.argv[2] ?? 0) })));
