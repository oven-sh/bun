// Functions made from text at run time that call charCodeAt: on strings of narrow and of wide characters, ropes, empty strings, with indexes inside, at the ends, outside, negative,
// fractional, absent, of other types; on receivers that are no strings; with a charCodeAt that is not the built-in. Each case runs several times: the first run links.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 4; turn++) {
    try {
      seen.push(String(JSON.stringify(run(turn)) ?? "undefined"));
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const make = (parameters, text) => new Function(...parameters, text);
const at = make(["s", "i"], "return s.charCodeAt(i);");
const next = make(["s", "i"], "return s.charCodeAt(i + 1);");
const none = make(["s"], "return s.charCodeAt();");
const more = make(["s", "i"], "return s.charCodeAt(i, 1, 2);");
const all = make(["s"], "const codes = []; for (let i = -1; i <= s.length; i++) codes.push(String(s.charCodeAt(i))); return codes.join();");
const prefix = make(["path", "i"], "return path.charCodeAt(i + 1) === 117 && path.charCodeAt(i + 2) === 115 && path.charCodeAt(i + 3) === 101 && path.charCodeAt(i + 4) === 114;");
const handed = make(["f", "s", "i"], "return f.call(s, i);");
const bare = make(["f", "i"], "return f(i);");
const ignored = make(["s", "i"], "s.charCodeAt(i); return 'done';");
const tail = make(["s", "i"], "'use strict'; return s.charCodeAt(i);");
const text = value => (Number.isNaN(value) ? "NaN" : value);

const strings = {
  narrow: () => "/users/42",
  "one character": () => "x",
  empty: () => "",
  "the last narrow character": () => "aÿ",
  wide: () => "Ж中😀z",
  "a rope": turn => "/us" + String(turn) + "ers/" + String(turn * 7),
  "a wide rope": turn => "中" + String(turn) + "Ж",
  "a piece of a string": () => "prefix/users/42".slice(6),
  "a piece of a string made at run time": turn => ("q" + turn + "/users/42?page=" + turn).slice(2, 11),
  "a piece of a piece": turn => ("q" + turn + "xx/users/42?page=" + turn).slice(2).slice(2, 11),
  "a piece of a wide string": turn => ("\u4e2d" + turn + "/user\u0416\ud83d\ude00?" + turn).slice(2, 10),
  "a piece of one character": turn => ("ab" + turn + "cd").slice(3, 4),
  "an empty piece": turn => ("ab" + turn).slice(1, 1),
  "a piece by substring": turn => ("q" + turn + "/users/42?page=2").substring(2, 11),
  "made from codes": () => String.fromCharCode(47, 117, 115, 101, 114, 0x416),
};
const indexes = [0, 1, 2, 5, 8, 9, 10, -1, -0, 0.5, 1.9, -0.5, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -(2 ** 31), NaN, Infinity, -Infinity, "1", "x", null, undefined, true, [2], { valueOf: () => 3 }, 1n];
for (const [name, string] of Object.entries(strings)) {
  show(name + ", every index", turn => all(string(turn)));
  show(name + ", no index", turn => text(none(string(turn))));
  show(name + ", prefix", turn => [prefix(string(turn), 0), prefix(string(turn), -1), prefix(string(turn), 1)]);
  for (const index of indexes) {
    const label = typeof index === "bigint" ? "1n" : Object.is(index, -0) ? "-0" : typeof index === "object" && index !== null ? (Array.isArray(index) ? "[2]" : "{valueOf}") : String(index) + ":" + typeof index;
    show(name + " at " + label, turn => [at, next, more, tail].map(f => { try { return text(f(string(turn), index)); } catch (error) { return error.constructor.name; } }));
  }
}

const receivers = {
  "a String object": () => new String("abc"),
  "a number": () => 12345,
  "a boolean": () => true,
  "an array": () => ["ab", "c"],
  "an object with toString": () => ({ toString: () => "xyz", charCodeAt: String.prototype.charCodeAt }),
  "an object with its own charCodeAt": () => ({ charCodeAt: i => "mine " + i }),
  "an instance of a class with charCodeAt": () => new (class { charCodeAt(i) { return "method " + i; } })(),
  "a symbol": () => Symbol("s"),
  null: () => null,
  undefined: () => undefined,
};
for (const [name, receiver] of Object.entries(receivers)) {
  show(name + " by member", turn => text(at(receiver(turn), 1)));
  show(name + " by call", turn => text(handed(String.prototype.charCodeAt, receiver(turn), 1)));
}
show("without a receiver", () => text(bare(String.prototype.charCodeAt, 1)));
show("another function of strings", () => [handed(String.prototype.charAt, "abc", 1), handed(String.prototype.codePointAt, "😀", 0), handed(String.prototype.at, "abc", -1)]);
show("the result is not used", turn => [ignored("abc", turn), ignored("abc", 99)]);
show("one site, many receivers", turn => [at("abc", turn), at("中Ж中Ж", turn), at({ charCodeAt: i => i * 2 }, turn), text(at("a" + turn, turn)), text(at(new String("wxyz"), turn))]);
const withProperties = String.prototype.charCodeAt;
show("the name and the length of the function are asked for first", turn => [withProperties.name, withProperties.length, at("abc", turn % 3)]);
show("the index changes the receiver's variable", () => make(["s"], "let t = s; return t.charCodeAt((t = 'zzz', 1));")("abc"));
show("in a loop over a long string", () => make(["s"], "let sum = 0; for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0; return sum;")("the quick brown fox Ж jumps".repeat(50)));
console.log(lines.join("\n"));
