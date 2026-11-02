// In how many bits JSON.parse holds a name of more than 16 characters, all ASCII once decoded, that has an escape in it.
import { jscDescribe } from "bun:jsc";
const widthOf = value => {
  const found = /8Bit:\((\d)\),length:\((\d+)\)/.exec(jscDescribe(value));
  return found ? `${found[1] === "1" ? 8 : 16}/${found[2]}` : "?";
};
const held = text => Buffer.from(text, "utf16le").toString("utf16le");
const narrow = text => Buffer.from(text, "latin1").toString("latin1");
let serial = 0;
const fresh = length => { let name = "n" + (serial++).toString(36) + "q"; while (name.length < length) name += "kcxbzayx"[(name.length * 7 + serial) % 8]; return name; };
for (const length of [8, 16, 17, 20, 27, 28, 40]) {
  for (const [escape, spell] of Object.entries({
    "none": name => name,
    "\\u006b in front": name => "\\u006b" + name.slice(1),
    "\\u006b inside": name => name.slice(0, 5) + "\\u006b" + name.slice(6),
    "\\/ at the end": name => name.slice(0, -1) + "\\/",
  })) {
    for (const [how, hold, tail] of [["8 bits", narrow, '"b"'], ["16 bits, no wide character", held, '"b"'], ["16 bits, a wide value", held, '"中"']]) {
      const text = hold('{"' + spell(fresh(length)) + '":1,"second":' + tail + "}");
      const parsed = JSON.parse(text);
      console.log(String(length).padStart(2), escape.padEnd(18), how.padEnd(28), Object.keys(parsed).map(widthOf).join(" "));
    }
  }
}
