// What a CommonJS file stores on process is no export of node:process for an importer that names node:process in front of the file, where import() loads the importer.
import("./importer.mjs").then(() => console.log("imported"));
