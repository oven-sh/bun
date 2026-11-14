// Loops over matchAll() of a literal: results read at places, by name, kept, returned, left by break, continue, return, throw and an outer label; one in another, in generators and async functions, under try and finally. Beside them: an iterator that is kept, a pattern that may match nothing, one without g, a pattern of two flags. What is printed is what plain Bun prints.
// STATISTIC: MatchIterationsInlined >= 12
const unseen = x => [x][JSON.parse("0")];
const log = [];
const show = p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : Array.isArray(p) ? `[${Array.from(p, show).join()}|${p.index}|${p.groups ? JSON.stringify(p.groups) : ""}]` : String(p));
const say = (...parts) => log.push(parts.map(show).join(" "));
const places = given => { const text = String(given); let n = 0; for (const m of text.matchAll(/([a-z]+)(\d)?/g)) { n += m[0].length + m.index; if (m[2] !== undefined) say(m[1], m[2], m.length, m.input === text); } return n; };
const names = given => { const text = String(given); const out = []; for (const m of text.matchAll(/(?<key>\w+)=(?<value>\w+)?/gi)) out.push(m.groups.key + ":" + (m.groups.value ?? "none")); for (const { groups: { key, other = "no" } } of text.matchAll(/(?<key>\w)./gs)) out.push(key + other); return out.join(); };
const taken = given => { const text = String(given); let n = 0; for (const [whole, one, two = "none"] of text.matchAll(/(\w)(\d)?/g)) { n += whole.length; say(one, two); if (n > 12) break; } return n; };
const kept = given => { const text = String(given); const all = []; let last; for (const m of text.matchAll(/(\w)(-)?/g)) { all.push(m); last = m; } say(all.length, last); return all; };
const left = given => { const text = String(given); outer: for (let turn = 0; turn < 3; turn++) { for (const m of text.matchAll(/\w+/gu)) { if (m[0].length === 1) continue; if (m.index > 8) continue outer; if (turn === 2) return m[0] + turn; if (m[0] === "stop") break outer; say(turn, m[0]); } } return "end"; };
const inner = given => { const text = String(given); let out = ""; for (const m of text.matchAll(/\S+/g)) { let n = 0; for (const k of m[0].matchAll(/[a-z]|(\d)/g)) { n += k.index; if (k[1]) out += k[1]; } out += n + ";"; } return out; };
const thrown = given => { const text = String(given); let n = 0; try { for (const m of text.matchAll(/./gs)) { n++; if (m[0] === "x") throw m; } } catch (error) { return error; } finally { say("finally", n); } return n; };
function* yielded(given) { const text = String(given); for (const m of text.matchAll(/(\w+)\W*/gv)) { const sent = yield m[1]; if (sent) say("sent", sent, m.index); } }
const awaited = async given => { const text = String(given); let out = ""; for (const m of text.matchAll(/\d+|[a-z]/g)) { await null; out += m[0] + m.index; } return out; };
const sticky = given => { const text = String(given); let n = 0; for (const m of text.matchAll(/[a-z]/gy)) n += m.index + 1; return n; };
const others = given => {
  const text = String(given);
  let n = 0;
  for (const m of text.matchAll(/\d*/g)) n += m.index + m[0].length;
  const iterator = text.matchAll(/\w/g);
  for (const m of iterator) { n += m.index; break; }
  for (const m of iterator) n += m.index;
  const pattern = /[a-z]/g;
  pattern.lastIndex = 2;
  for (const m of text.matchAll(pattern)) n += m.index;
  say(pattern.lastIndex, String(text.matchAll(/a/g)), [...text.matchAll(/\w/g)].length);
  try { for (const m of text.matchAll(/a/)) n++; } catch (error) { say(error.name); }
  return n;
};
const statics = given => { const text = String(given); for (const m of text.matchAll(/(\w)(\d)/g)) say(RegExp.$1, RegExp.lastMatch, RegExp.leftContext.length); say(RegExp.$2); };
for (const text of unseen(["", "abc12 de3", "k=v a= B=9 x", "stop me not", "日a1 b2éx", "a-b-c-", "😀x1 y", "w".repeat(40) + " 7"])) {
  for (const given of [text, text.slice(1), unseen("z0 ") + text]) {
    for (const run of [places, names, taken, kept, left, inner, thrown, sticky, others]) { try { say(run.name, run(given)); } catch (error) { say(error.name); } }
    const steps = yielded(given);
    say(steps.next().value, steps.next("one").value, [...yielded(given)].length, steps.return(5).value);
    statics(given);
    say(await awaited(given));
  }
}
console.log(log.length);
console.log(log.join("\n"));
