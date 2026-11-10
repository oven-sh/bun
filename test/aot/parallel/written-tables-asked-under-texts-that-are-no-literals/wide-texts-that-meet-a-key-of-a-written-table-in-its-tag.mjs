const C = new Map([["待機中の接続ですよねえ", 1], ["開いた接続ですよねええ", 2], ["忙しい接続ですよねええ", 3], ["閉じた接続ですよねええ", 4], ["waiting-connection-é", 5], ["an-open-connection-ж", 6], ["a-long-narrow-word-one", 7], ["a-long-narrow-word-two", 8], ["ключ-из-кириллицы-01", 9], ["ключ-из-кириллицы-02", 10], ["λέξη-στα-ελληνικά-α", 11], ["λέξη-στα-ελληνικά-β", 12]]);
const S = new Set(["待機中の接続ですよねえ", "開いた接続ですよねええ", "忙しい接続ですよねええ", "閉じた接続ですよねええ", "waiting-connection-é", "an-open-connection-ж", "a-long-narrow-word-one", "a-long-narrow-word-two", "ключ-из-кириллицы-01", "ключ-из-кириллицы-02", "λέξη-στα-ελληνικά-α", "λέξη-στα-ελληνικά-β"]);
const words = JSON.parse('["待機中の接続ですよねえ","開いた接続ですよねええ","忙しい接続ですよねええ","閉じた接続ですよねええ","waiting-connection-é","an-open-connection-ж","a-long-narrow-word-one","a-long-narrow-word-two","ключ-из-кириллицы-01","ключ-из-кириллицы-02","λέξη-στα-ελληνικά-α","λέξη-στα-ελληνικά-β"]');
const asked = [];
for (const word of words) {
  asked.push(word);
  for (let i = 0; i < 3000; i++) {
    const two = (i + 36).toString(36).padStart(2, "0").slice(-2), wide = String.fromCharCode(0x3041 + i % 80) + String.fromCharCode(0x30a1 + (i >> 3) % 80);
    asked.push(word.slice(0, -2) + two);
    asked.push(word.slice(0, -2) + wide);
    asked.push(two + word.slice(2));
    asked.push(word + two);
  }
}
const texts = JSON.parse(JSON.stringify(asked));
let found = 0, present = 0, sum = 0;
for (let round = 0; round < 2; round++) {
  for (const text of texts) {
    const value = C.get(text);
    if (value !== undefined) { found++; sum = (sum * 31 + value + text.length) % 1000003; }
    if (C.has(text)) present++;
    if (S.has(text)) present += 2;
  }
}
console.log(texts.length, found, present, sum);
