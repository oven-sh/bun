// The CommonJS file of the ring lacks the name: the ES module alone brings it, and the program is valid.
let said;
try {
  said = (await import("./reader.mjs")).look();
} catch (error) {
  said = error.name + (String(error.message).includes("ambiguous") ? ": ambiguous" : "");
}
console.log(said);
