// A string built in a loop that holds one character when it is finished is the string of that character: no call makes it.
// COUNT: operation:operationAOTStackStringBuilderFinish <= 100
function digits(n) {
  let text = "";
  do {
    text += "0123456789abcdefghijklmnopqrstuvwxyzé☃"[n % 38];
    n = Math.trunc(n / 38);
  } while (n > 0);
  return text;
}
function marks(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) if (list[i] > 2) text += "<";
  return text;
}
function doubled(n) {
  let text = "";
  for (let i = 0; i < n; i++) text += i;
  return text;
}
const seen = new Map();
let one = 0, same = 0, last = "";
for (let i = 0; i < 400; i++) {
  const text = digits(i % 41);
  seen.set(text, (seen.get(text) ?? 0) + 1);
  if (text.length === 1) one++;
  if (text === last) same++;
  if (i % 41 === 5 && text === "5" && Object.is(text, "5")) same++;
  last = text;
}
for (let i = 0; i < 20; i++) one += marks([i % 4, 3 * (i & 1)]).length + doubled(i % 3).length;
console.log(one, same, [...seen].map(([key, n]) => key + n + key.codePointAt(0)).join(" "));
