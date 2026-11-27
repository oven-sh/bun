const unseen = x => [x][JSON.parse("0")];
const subjects = unseen(["ab12", "x-y", "key=value", "", "zz9", "q".repeat(80) + "7"]);
const HELD = /([a-z]+)(\d+)/;
function work(list) {
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (/(\w)-(\w)/.test(s)) t++;
    const m = HELD.exec(s);
    if (m) t += m[1].length;
    t += s.search(/=(v)/);
    t += s.replace(/([0-9])/g, "#").length;
    const n = s.match(/^(\w+)=(\w+)/);
    if (n) t += n[2].length;
  }
  return t;
}
console.log(work(subjects));
const names = unseen(["$1", "$2", "input", "$_", "lastMatch", "$&", "lastParen", "$+", "leftContext", "$`", "rightContext", "$'", "multiline"]);
console.log(unseen(HELD).constructor.$1, unseen([HELD])[0].constructor.lastMatch);
