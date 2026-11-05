// In how many bits a parse under a type that lists fewer members than the source has holds a long ASCII name with an escape in it.
import { jscDescribe } from "bun:jsc";
const widthOf = (value: unknown) => {
  const found = /8Bit:\((\d)\),length:\((\d+)\)/.exec(jscDescribe(value));
  return found ? `${found[1] === "1" ? 8 : 16}/${found[2]}` : "?";
};
interface Known { second: string }
const held = (text: string) => Buffer.from(text, "utf16le").toString("utf16le");
const narrow = (text: string) => Buffer.from(text, "latin1").toString("latin1");
let serial = 0;
const fresh = (length: number) => { let name = "t" + (serial++).toString(36) + "q"; while (name.length < length) name += "kcxbzayx"[(name.length * 7 + serial) % 8]; return name; };
function parse(text: string): Known { return JSON.parse(text) as Known; }
for (const length of [8, 16, 17, 20, 27, 28, 40]) {
  for (const [escape, spell] of Object.entries({
    "none": (name: string) => name,
    "\\u006b inside": (name: string) => name.slice(0, 5) + "\\u006b" + name.slice(6),
    "\\/ at the end": (name: string) => name.slice(0, -1) + "\\/",
  })) {
    for (const [how, hold, tail] of [["8 bits", narrow, '"b"'], ["16 bits, no wide character", held, '"b"'], ["16 bits, a wide value", held, '"中"']] as const) {
      const parsed = parse(hold('{"' + spell(fresh(length)) + '":1,"second":' + tail + "}"));
      console.log(String(length).padStart(2), escape.padEnd(18), how.padEnd(28), Object.keys(parsed).map(widthOf).join(" "));
    }
  }
}
