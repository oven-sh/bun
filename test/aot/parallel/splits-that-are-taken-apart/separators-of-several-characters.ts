function pair(text: string): string {
  const parts = text.split(": ");
  return parts.length + "|" + parts[0] + "|" + parts[1] + "|" + parts[2];
}
function doubled(text: string): string {
  const parts = text.split("aa");
  return [parts.length, parts[0], parts[1], parts[2], parts[3]].join("|");
}
function firstAlone(text: string): string | undefined {
  return text.split("\r\n")[0];
}
function lengthAlone(text: string): number {
  return text.split("--").length;
}
function wide(text: string): string {
  const [head, tail] = text.split("→→");
  return head + "~" + tail;
}
function mixed(text: string): string {
  const parts = text.split("é→");
  return parts.length + "|" + parts[0] + "|" + parts[1];
}
const long = "x".repeat(70);
const seen: unknown[] = [];
for (const t of ["", ":", ": ", ": : ", "a: b", "a: b: c: d", "a:b", " : ", "a: ", ": b", long + ": " + long, "用: 户: x", "é: ü"]) seen.push(pair(t));
for (const t of ["", "a", "aa", "aaa", "aaaa", "aaaaa", "baab", "aabaa", "用aa户aaa"]) seen.push(doubled(t));
for (const t of ["", "\r\n", "one\r\ntwo", "one\ntwo", "\rone\r\n", long + "\r\n"]) seen.push(firstAlone(t));
for (const t of ["", "-", "--", "---", "----", "a--b--c", long + "--" + long + "--", "用--户"]) seen.push(lengthAlone(t));
for (const t of ["", "ab", "a→→b", "→→", "a→b", "→→→", long + "→→" + long]) seen.push(wide(t).length + ":" + wide(t).slice(0, 9));
for (const t of ["", "é", "aé→b", "é→é→", "plain"]) seen.push(mixed(t));
console.log(JSON.stringify(seen));
