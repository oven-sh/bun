// Assorted, one probe of many. It prints what plain Bun prints.
let seen = "";
process.removeAllListeners("warning");
process.on("warning", w => { seen += w.name + ":" + (w as any).code + ":" + w.message + ";"; });
process.emitWarning("text", "CustomName", "CODE1");
process.emitWarning("plain");
process.emitWarning(new RangeError("object"));
process.emitWarning("detailed", { type: "T", code: "C", detail: "D" });
setTimeout(() => console.log(seen), 10);
