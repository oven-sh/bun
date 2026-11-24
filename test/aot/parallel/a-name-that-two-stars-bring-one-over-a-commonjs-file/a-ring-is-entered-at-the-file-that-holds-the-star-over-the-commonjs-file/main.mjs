// A ring of stars brings one name from an ES module and from a CommonJS file: the language refuses it, whichever file of the ring is loaded first.
let said;
try {
  said = (await import("./reader.mjs")).look();
} catch (error) {
  said = error.name + (String(error.message).includes("ambiguous") ? ": ambiguous" : "");
}
console.log(said);
