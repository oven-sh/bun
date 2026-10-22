let calls = 0;
class Special extends ArrayBuffer {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const special = new Special(8, { maxByteLength: 16 });
console.log("made");
const result = special.slice(1, 2);
console.log(typeof result, result.byteLength);
console.log(calls);
