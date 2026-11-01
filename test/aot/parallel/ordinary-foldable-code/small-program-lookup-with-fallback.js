const MIME = { html: "text/html", js: "text/javascript", json: "application/json", png: "image/png" };
const FILES = ["index.html", "app.js", "data.json", "logo.png", "README", "archive.tar.gz"];
const typeOf = (f) => MIME[f.includes(".") ? f.split(".").pop() : ""] || "application/octet-stream";
console.log(FILES.map((f) => `${f}: ${typeOf(f)}`).join("\n"));
