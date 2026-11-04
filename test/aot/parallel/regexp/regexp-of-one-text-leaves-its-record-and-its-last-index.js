// a RegExp that is one text is matched with, and then RegExp.lastMatch, RegExp["$`"] and lastIndex under g and y are read
function plain(s) {
  return /ab/.test(s) + ":" + RegExp.lastMatch + ":" + RegExp["$`"] + ":" + s.search(/cd/) + ":" + RegExp.lastMatch;
}
function stepping(s) {
  const all = /ab/g;
  const sticky = /ab/y;
  const out = [];
  for (let i = 0; i < 4; i++) out.push(all.test(s) + "@" + all.lastIndex + "/" + sticky.test(s) + "@" + sticky.lastIndex);
  return out.join(",");
}
function deed() {
  return [plain("xxabcd"), plain("cdab"), plain("none but cd"), stepping("ababxab"), stepping("")].join(" | ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
