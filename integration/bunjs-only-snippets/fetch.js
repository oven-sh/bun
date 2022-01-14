import fs from "fs";

const response = await fetch("http://example.com/");
const text = await response.text();

if (
  fs.readFileSync(
    import.meta.filePath.substring(0, import.meta.filePath.lastIndexOf("/")) +
      "/fetch.js.txt",
    "utf8"
  ) !== text
) {
  throw new Error("Expected fetch.js.txt to match snapshot");
}
