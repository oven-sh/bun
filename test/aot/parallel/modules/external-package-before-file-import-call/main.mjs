// A CommonJS package marked external runs before the CommonJS file that the importer names behind it, and neither its body nor the job it queues runs inside the import() call of a file one level below.
// Flags: --external outside-file
import("./importer.mjs").then(() => console.log("imported"));
