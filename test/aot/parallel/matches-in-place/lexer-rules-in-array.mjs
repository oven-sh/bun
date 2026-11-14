const rules = [["number", /^(\d+)(\.\d+)?/], ["name", /^([a-z]+)(\()?/], ["space", /^(\s+)()/]];
function lex(s) { const out = []; while (s) { let hit = false; for (const [kind, re] of rules) { const m = re.exec(s); if (!m) continue; const parts = []; for (let i = 0; i < m.length; i++) if (m[i]) parts.push(m[i]); out.push(kind + ":" + parts.join("|")); s = s.slice(m[0].length); hit = true; break; } if (!hit) break; } return out.join(" "); }
console.log(lex("12.5 foo( 7 bar 3.25 baz(")); console.log(lex("7 x"));
