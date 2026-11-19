// String.fromCodePoint reached as a value that nobody follows, so that the host's own function is entered: one code of each kind, what is refused, and what is no int32.
const held = { make: [String.fromCodePoint, String.fromCharCode][JSON.parse("0")] };
const seen = [];
for (const code of [0, 65, 255, 256, 0x20ac, 0xd800, 0xffff, 0x10000, 0x1f600, 0x10ffff]) {
  const text = held.make(code);
  seen.push(text.length + ":" + [...text].map(part => part.codePointAt(0).toString(16)).join("."));
}
console.log(seen.join(" "));
for (const code of [-1, 0x110000, 1.5, NaN, Infinity, "x", undefined, 2 ** 31, -(2 ** 31)]) {
  try {
    console.log(String(code), JSON.stringify(held.make(code)));
  } catch (error) {
    console.log(String(code), error.name, error.message);
  }
}
console.log(JSON.stringify(held.make()), JSON.stringify(held.make(65, 66)), JSON.stringify(held.make("65")), JSON.stringify(held.make(65.0)), JSON.stringify(held.make(-0)), JSON.stringify(held.make({ valueOf: () => 66 })), JSON.stringify(held.make(null)), JSON.stringify(held.make(true)));
let text = "";
for (let at = 0; at < 300000; at += 1) text += held.make(97 + (at % 26));
console.log(text.length, text.slice(0, 30), held.make(97) === held.make(97));
