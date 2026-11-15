const BLANK = 32;
const TAB = 9;
const END = 59;
function pastBlanks(text: string, at: any, end: any) {
  while (at < end) {
    const unit = text.charCodeAt(at);
    if (unit !== BLANK && unit !== TAB) break;
    at++;
  }
  return at;
}
function pastWord(text: string, at: any, end: any, stop: any) {
  while (at < end) {
    const unit = text.charCodeAt(at);
    if (unit === END || unit === stop) break;
    at++;
  }
  return at;
}
function word(text: string, from: any) {
  const end = text.length;
  let at = pastBlanks(text, from, end);
  const begin = at;
  at = pastWord(text, at, end, 65536);
  return String(begin) + ":" + String(at) + ":" + text.slice(begin, at);
}
const texts: string[] = JSON.parse('["  plain/text; more", "plain", "ab;", "ab;cd", "ab;cd;", ""]');
console.log(word(texts[0], 0), word(texts[1], undefined), word(texts[2], 4294967296), word(texts[3], -2), word(texts[4], 3), word(texts[5], 0), word(texts[0], 2147483647), word(texts[0], -5));
