// A binding of the module named Buffer is called in place of the global, in every function of the module.
// STATISTIC: ByteLiteralsEncoded = 1
const Buffer = {
  from(input: string, encoding?: string) {
    return "the module's Buffer got " + input + " " + encoding;
  },
};
class TextEncoder {
  encode(input: string) {
    return "the module's TextEncoder got " + input;
  }
}
function inFunction() {
  return [Buffer.from("literal"), Buffer.from("6869", "hex"), new TextEncoder().encode("literal")].join(" | ");
}
console.log(Buffer.from("at top level"));
console.log(inFunction());
console.log(globalThis.Buffer.from("6869", "hex").toString());
export {};
