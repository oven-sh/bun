import fs from "fs";

const response = await fetch("http://example.com/");
const text = await response.text();

if (
  fs.readFileSync(
    import.meta.path.substring(0, import.meta.path.lastIndexOf("/")) +
      "/fetch.js.txt",
    "utf8"
  ) !== text
) {
  throw new Error("Expected fetch.js.txt to match snapshot");
}
