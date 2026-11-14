// STATISTIC: RegExpMatchAllocationsElided >= 6
const texts = JSON.parse(JSON.stringify(["abc1", "#note", "12 x", "", "\n", "ét", "zz", "=", "x9y", "  q"]));
const parts = () => texts.concat(texts.map((t) => ("<" + t + ">").slice(1, -1)));
function scan(source, regexp) { return source.match(regexp); }
function chain(list) {
  let log = "";
  for (const s of list) {
    let m;
    if ((m = scan(s, /^#(.*)/))) log += "note ";
    else if ((m = scan(s, /^([a-z]+)(\d)?/))) log += "word " + m[2] + " ";
    else if ((m = /^\d+/.exec(s))) log += "number ";
    else if ((m = s.match(/^\W/))) log += "other ";
    else continue;
    log += m[0] + "/" + m[0].length + ",";
  }
  return log;
}
function destructured(list) {
  let log = "";
  for (const s of list) {
    let m = s.match(/^(x)?(\w)/);
    if (!m) m = s.match(/^()(.)/);
    if (m === null) continue;
    const [whole, , second] = m;
    log += whole + second + (m[1] === undefined ? "u" : m[1]) + ",";
  }
  return log;
}
const kept = [];
function escapes(list) {
  let log = "";
  for (const s of list) {
    let m;
    if ((m = scan(s, /^(\w)(\w)/))) kept.push(m);
    else if ((m = s.match(/^.(.)?/))) log += m.index + "" + m.length;
    else continue;
    log += m[0] + JSON.stringify(m) + m.input.length + ",";
  }
  return log + kept.map((m) => m.join("-") + m.index).join();
}
function recorded(list) {
  let log = "";
  for (const s of list) {
    let m;
    if ((m = scan(s, /^(\w)(\w)/))) ;
    else if ((m = s.match(/^(.)/))) ;
    else continue;
    log += m[1] + RegExp.$1 + RegExp.lastMatch + ",";
  }
  return log;
}
for (let round = 0; round < 2; round++) for (const f of [chain, destructured, escapes, recorded]) console.log(f.name, f(parts()));
