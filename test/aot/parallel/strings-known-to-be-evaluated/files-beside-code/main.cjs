// Code that reads embedded files, joins them and hands the text to Function, which makes constructors out of strings in turn.
// Flags: --asset ./kit --asset ./modern
const say = (...a) => console.log(...a.map(x => (typeof x === "function" ? x.toString() : x)));
const attempt = f => {
  try {
    return f();
  } catch (e) {
    return e.name + ": " + e.message;
  }
};
const kit = require("./kit/tools/index.js");
say(Object.keys(kit).sort().join());
const leaf = new kit.NODE_Leaf({ start: 1, value: "x" });
const pair = new kit.NODE_Pair({ start: 2, left: leaf, right: new kit.NODE_Leaf({ value: "y" }) });
say(kit.print(pair), leaf instanceof kit.NODE_Any, pair.size(), JSON.stringify(leaf), Object.keys(pair).join());
say(kit.NODE_Leaf, kit.NODE_Pair.name, kit.NODE_Pair.length, kit.NODE_Any.SUBCLASSES.map(it => it.TYPE).join());
say(kit.tokens("if (a1 >= 10) /* c */ b <!-- c\n--> d"), kit.options.join(), kit.describe());
say(attempt(() => kit.NODE_Leaf({ value: 1 })), typeof globalThis.value, globalThis.value, delete globalThis.value, delete globalThis.start, delete globalThis.flags);
say(attempt(() => kit.strictThis()), attempt(() => kit.sloppyThis()));
say(attempt(() => kit.fails(null)), kit.line(() => kit.fails(null)));
say(kit.patched(), kit.fromBytes(2), kit.fromTemplate(3), kit.perCall(1) === kit.perCall(1), kit.perCall(2)(5));
say(kit.source.startsWith('"use strict"'), kit.make.toString() === "function anonymous(words,exports\n) {\n" + kit.source + "\n}");
import("./modern/index.mjs").then(it => {
  say(it.add(1, 2), it.twice(4), it.named(5));
});
