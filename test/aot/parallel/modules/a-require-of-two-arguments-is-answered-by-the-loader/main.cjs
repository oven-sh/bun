let kind;
try {
  kind = typeof require("./NOTICE", {});
} catch {
  kind = "threw";
}
console.log(JSON.stringify(require("./notes.txt", {})), kind);
