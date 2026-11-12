const word = /[a-z]+/y, space = /\s+/y, digits = /[0-9]+/y;
function lex(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let found = false;
    for (const rule of [space, word, digits]) {
      rule.lastIndex = at;
      const match = rule.exec(text);
      if (!match) continue;
      if (rule !== space) out.push(match[0]);
      at = rule.lastIndex;
      found = true;
      break;
    }
    if (!found) out.push(text[at++]!);
  }
  return out;
}
for (let turn = 0; turn < 50; turn++) lex("let abc = 12 + x9");
console.log(lex("let abc = 12 + x9; if (y) z = 7").join("|"));
const all = /a(b?)/g;
let m: RegExpExecArray | null, places = "";
while ((m = all.exec("ab a ab aab"))) places += m.index + ":" + all.lastIndex + " ";
console.log(places, all.lastIndex);
