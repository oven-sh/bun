const table: Record<string, (value: any) => unknown> = { n: Number, s: String, b: Boolean };
const key = process.argv[2] ?? "n";
console.log("SAID", ["1", "2"].map(table[key]), [1, 2].map(table[key === "n" ? "s" : "n"]));
