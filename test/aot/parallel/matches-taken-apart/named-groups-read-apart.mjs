// The named groups of a match, read off its groups object in a loop: by name, by a pattern of names, through a test for nothing, a name that no group has, and groups that took no part. Beside them: the object kept, listed, written and handed on, a name that two groups share, an accessor that a subclass has. What is printed is what plain Bun prints.
// STATISTIC: MatchGroupObjectsElided >= 5
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => log.push(parts.map(p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : p && typeof p === "object" ? JSON.stringify(p) : String(p))).join(" "));
const lexer = (() => {
  var Token = /(?<word>[a-z]\w*)|(?<number>\d+(?<fraction>\.\d*)?)|(?<space>\s+)|(?<mark>[^\w\s])/y, Pair = /(?<key>\w+)=(?<value>\w+)?/g;
  return function (text, turns) {
    const input = String(text);
    let last = 0, n = 0;
    while (last < input.length) {
      Token.lastIndex = last;
      const m = Token.exec(input);
      if (m === null) { last++; continue; }
      last = Token.lastIndex;
      const g = m.groups;
      if (g.word !== undefined) say("word", g.word, g.number, m[0] === g.word);
      else if (g.number) say("number", g.number, g.fraction, m.index);
      else if (g.space !== undefined) n += g.space.length;
      else say("mark", g.mark, g.missing, g.index, g.constructor);
      for (let turn = 0; turn < turns; turn++) n += (g.word || g.mark || "").length;
    }
    let m;
    Pair.lastIndex = 0;
    while ((m = Pair.exec(input))) { const { key, value } = m.groups; say("pair", key, value, Pair.lastIndex); }
    return n;
  };
})();
const once = text => { const m = /(?<year>\d{4})-(?<month>\d\d)(?:-(?<day>\d\d))?/.exec(text); if (!m) return "none"; return m.groups.year + "/" + m.groups.month + "/" + m.groups.day; };
const asked = text => { let out = ""; for (let i = 0; i < 3; i++) { const day = text.match(/^(?<a>.)(?<b>..)?/)?.groups?.b; out += day; } return out; };
const others = text => {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const m = /(?<a>\w)(?<b>\d)?/.exec(text);
    if (!m) continue;
    const g = m.groups;
    switch (i) {
      case 0: out.push(Object.keys(g).join(), Object.getPrototypeOf(g), "a" in g, g.hasOwnProperty); break;
      case 1: g.a = "written"; out.push(g.a, m.groups.a, m.groups === g); break;
    }
  }
  const two = /(?<x>a)|(?<x>b)/.exec(text);
  if (two) out.push(two.groups.x, two[1], two[2]);
  const none = /(a)|./.exec(text);
  try { if (none) out.push(none.groups, none.groups.x); } catch (error) { out.push(error.name); }
  const kept = [];
  for (const piece of text.split("")) { const m = /(?<c>\w)/.exec(piece); if (m) kept.push(m.groups); }
  out.push(kept.map(k => k.c).join(""), kept.length);
  const proto = /(?<__proto__>\w)(?<index>\w)?/.exec(text);
  if (proto) out.push(proto.groups.__proto__, proto.groups.index, proto.index);
  return out;
};
for (const text of unseen(["", "ab 12.5 + c", "x=1 y= z=3", "2026-11-11", "2026-11", "a日b=é", "bbb", "7"])) {
  for (let turns = 0; turns < 3; turns++) say(lexer(text, turns));
  say(lexer(text.slice(0, 2) + unseen("q=9 w"), 1));
  say(once(text), asked(text));
  for (const other of others(text)) say(other);
}
console.log(log.length);
console.log(log.join("\n"));
