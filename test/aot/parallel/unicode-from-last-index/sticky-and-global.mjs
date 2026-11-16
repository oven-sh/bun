// Unicode patterns that begin at lastIndex: sticky and global, on narrow, wide and composed texts, inside and behind pairs of surrogates.
const unseen = x => [x][JSON.parse("0")];
const patterns = unseen([/[a-z]+/yu, /[a-z]+/gu, /\p{L}+/yu, /\p{L}/gu, /./yu, /./gu, /(\d)|(\p{Lu})/gu, /\u{1f600}|x/yu, /[\u{1f600}-\u{1f64f}a-c]/gu, /(?<=a)b/gu, /\b\w/yu, /[^]/gu, /\s*/yu, /[\p{L}--[a-c]]/gv, /é/yu, /K/giu, /$/yu, /(?:)/gu]);
const texts = unseen(["abc", "", "aBc1", "😀x", "x😀y", "\ud83d", "a\ude00b", "éa", "Āb", ("ab" + unseen("c") + "😀"), "xxabcxx".slice(2, 5), "K k K", "ab ab", "a".repeat(80) + "b"]);
function scan(re, text) {
  let t = "";
  re.lastIndex = 0;
  for (let turn = 0; turn < 6; turn++) {
    const found = re.exec(text);
    if (found === null) { t += "-" + re.lastIndex; break; }
    t += found.index + ":" + found[0].length + (found[1] ?? "") + "@" + re.lastIndex + " ";
    if (found[0] === "") re.lastIndex++;
  }
  return t;
}
function from(re, text) {
  let t = "";
  for (let start = 0; start < 5; start++) {
    re.lastIndex = start;
    t += re.test(text) ? "y" + re.lastIndex : "n" + re.lastIndex;
    re.lastIndex = start;
    const found = re.exec(text);
    t += found ? found[0].length : ".";
  }
  return t;
}
for (const re of patterns) console.log(String(re.flags), texts.map(text => scan(re, text) + "|" + from(re, text)).join(" ; "));
for (const last of unseen([-1, 1.5, NaN, "1", 2 ** 31, 2 ** 32 + 1, null, { valueOf() { return 1; } }])) console.log(patterns.map(re => { re.lastIndex = last; const ok = re.test("xabc"); return (ok ? 1 : 0) + String(re.lastIndex); }).join());
const fixed = Object.freeze(/[a-z]/yu);
for (const text of ["abc", "1"]) { try { console.log(fixed.test(text)); } catch (error) { console.log(error.constructor.name); } }
/(\p{L})(\d)/yu.test("a1"); console.log(RegExp.$1, RegExp.$2, RegExp.lastMatch);
const g = /(\p{L})(\d)/gu; g.lastIndex = 1; g.exec("za1"); console.log(RegExp.$1, RegExp.leftContext, g.lastIndex);
