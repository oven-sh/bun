// Under: --aot-harden=proof-checks: the loop's question about the length was asked again of the class below, and the program died
const { bytes, buffer, words } = await import("./part.ts");
function partition() {
  const pivot = bytes[0];
  let place = 0;
  for (let i = 0; i < bytes.length; i++)
    if (bytes[i] < pivot) {
      [bytes[i], bytes[place]] = [bytes[place], bytes[i]];
      place++;
    }
  return place;
}
function partitionOf(list) {
  const pivot = list[0];
  let place = 0;
  for (let i = 0; i < list.length; i++)
    if (list[i] < pivot) {
      [list[i], list[place]] = [list[place], list[i]];
      place++;
    }
  return place;
}
console.log(partition(), bytes.join(), bytes.toString());
console.log(partition(), bytes.join(), bytes.toString());
for (const list of [buffer, words, bytes, new Uint8Array(0), Buffer.alloc(2)]) console.log(partitionOf(list), list.join(), list.toString());
Object.defineProperty(bytes, "length", { value: 2 });
console.log(partition(), Array.from(bytes).join());
