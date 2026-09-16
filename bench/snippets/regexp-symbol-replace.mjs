// A direct call of RegExp.prototype[Symbol.replace], next to String.prototype.replace with the
// same RegExp. The node-ported builtins make the direct call through a primordial. The last
// group has three of their call sites.
import { Console } from "node:console";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { bench, group, run } from "../runner.mjs";

const symbolReplace = RegExp.prototype[Symbol.replace];
const uncurried = Function.prototype.call.bind(symbolReplace);

const short = ["abc 123 def 456 ghi", "abc 124 def 457 ghi"];
const short16 = ["abc 123 d\u00e9f 456 \u4e16\u754c", "abc 124 d\u00e9f 457 \u4e16\u754c"];
const long = [
  Buffer.alloc(16 * 1024, "lorem ipsum 12345 dolor sit amet, ").toString(),
  Buffer.alloc(16 * 1024, "lorem ipsum 12346 dolor sit amet, ").toString(),
];
const noMatch = ["abc def ghi jkl mno", "abc def ghi jkl mnp"];

const cases = [
  ["/\\d+/g, string", /\d+/g, "-", short],
  ["/\\d+/g, string, 16-bit", /\d+/g, "-", short16],
  ["/\\d+/, string", /\d+/, "-", short],
  ["/\\d+/g, empty string", /\d+/g, "", short],
  ["/(\\d)(\\d)/g, '$2$1'", /(\d)(\d)/g, "$2$1", short],
  ["/(?<a>\\d)(?<b>\\d)/g, '$<b>$<a>'", /(?<a>\d)(?<b>\d)/g, "$<b>$<a>", short],
  ["/\\d+/g, function", /\d+/g, match => "<" + match + ">", short],
  ["/\\d+/, function", /\d+/, match => "<" + match + ">", short],
  ["/\\d+/g, string, no match", /\d+/g, "-", noMatch],
  ["/\\d+/g, string, 16 KB", /\d+/g, "-", long],
  ["/\\d+/g, function, 16 KB", /\d+/g, match => "<" + match + ">", long],
];

for (const [name, regexp, replacement, inputs] of cases) {
  group(name, () => {
    let i = 0;
    bench("str.replace(re, v)", () => inputs[i++ & 1].replace(regexp, replacement));
    bench("re[Symbol.replace](str, v)", () => regexp[Symbol.replace](inputs[i++ & 1], replacement));
    bench("uncurryThis(RegExp.prototype[Symbol.replace])(re, str, v)", () =>
      uncurried(regexp, inputs[i++ & 1], replacement),
    );
  });
}

group("call sites in the builtins", () => {
  // strEscape() of one line of more than 100 characters.
  const escaped = [
    Buffer.alloc(240, "a line of text with 'quotes', a \"tab\"\t and a \\ ").toString(),
    Buffer.alloc(240, "a line of text with 'quotes', one \"tab\"\t and a \\ ").toString(),
  ];
  // formatArrayBuffer(): /(.{2})/g over the hex string.
  const buffers = [new ArrayBuffer(64), new ArrayBuffer(48)];
  // console.log() inside console.group(): /\n/g over each message.
  const sink = new Console(new Writable({ write: (chunk, encoding, callback) => callback() }));
  sink.group();
  const messages = ["first line\nsecond line\nthird line", "first line\nsecond line\nlast line"];

  let i = 0;
  bench("util.inspect(string with escapes, 240 chars)", () => inspect(escaped[i++ & 1]));
  bench("util.inspect(ArrayBuffer)", () => inspect(buffers[i++ & 1]));
  bench("console.log(3 lines) in a group", () => sink.log(messages[i++ & 1]));
});

await run();
