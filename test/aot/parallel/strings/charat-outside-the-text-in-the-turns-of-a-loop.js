// `text.charAt(i)` outside the text answers "": a text, as inside. A loop that begins behind the end, ends in front of the beginning, or steps over both goes on in the same turns.
const key = JSON.parse('["down","up","wide","keys","odd"]');
const table = {
  down(s) { let out = ""; for (let i = s.length + 2; i >= -2; i--) out += "[" + s.charAt(i) + "]"; return out; },
  up(s) { let n = 0; for (let i = -3; i < s.length + 3; i++) n = n * 3 + s.charAt(i).length; return n; },
  wide(s) { let n = 0; for (let i = 0; i < 40; i += 7) if (s.charAt(i) === "") n++; else n += s.charAt(i).charCodeAt(0); return n; },
  keys(s) { const seen = { "": 1, a: 2, b: 4 }; let n = 0; for (let j = s.length + 3; j >= 1; j -= 1) n += seen[s.charAt(j - 1)] | 0; return n; },
  odd(s) { let out = ""; for (const i of [0.5, 1.9, -0.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, -0, "1", undefined, null, true]) out += "[" + s.charAt(i) + "]"; return out; },
};
for (const s of [JSON.parse('"ab,c"'), "", "a", JSON.parse('"\\u00e9\\ud83d\\ude00b"'), "ab".repeat(30), ("xa".repeat(10) + "b").slice(1)]) for (let turn = 0; turn < 3; turn++) console.log(table[key[0]](s), table[key[1]](s), table[key[2]](s), table[key[3]](s), table[key[4]](s));
