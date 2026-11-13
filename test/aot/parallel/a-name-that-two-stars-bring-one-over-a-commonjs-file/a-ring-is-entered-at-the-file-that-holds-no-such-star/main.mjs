// The same ring, entered at the other end: refused as well.
let said;
try {
  said = (await import("./reader.mjs")).look();
} catch (error) {
  said = error.name + (String(error.message).includes("ambiguous") ? ": ambiguous" : "");
}
console.log(said);
