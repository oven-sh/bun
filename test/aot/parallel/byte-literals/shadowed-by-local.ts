// A local binding named Buffer, TextEncoder or Uint8Array is called in place of the global.
// STATISTIC: ByteLiteralsEncoded = 1
function withLocalBuffer() {
  const Buffer = { from: (input: string, encoding?: string) => "a local Buffer got " + input + " " + encoding };
  return Buffer.from("literal", "hex");
}
function withParameter(Buffer: { from(input: string): string }) {
  return Buffer.from("literal");
}
function withLocalClass() {
  class TextEncoder {
    encode(input: string) {
      return "a local TextEncoder got " + input;
    }
  }
  return new TextEncoder().encode("literal");
}
function withLocalTypedArray() {
  const Uint8Array = { fromBase64: (input: string) => "a local Uint8Array got " + input, fromHex: (input: string) => "hex " + input, of: (...numbers: number[]) => numbers.length };
  return [Uint8Array.fromBase64("aGk="), Uint8Array.fromHex("6869"), Uint8Array.of(1, 2, 3)].join(" | ");
}
console.log(withLocalBuffer());
console.log(withParameter({ from: input => "a parameter got " + input }));
console.log(withLocalClass());
console.log(withLocalTypedArray());
console.log(Buffer.from("the global still works", "latin1").toString("hex"));
export {};
