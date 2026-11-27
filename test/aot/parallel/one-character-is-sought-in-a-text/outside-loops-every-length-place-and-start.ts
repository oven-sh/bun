// The searches stand in a function without a loop, which calls itself for the next case: what is compiled for a search outside loops runs. One character is sought in texts of every length to 150, at every place, twice, or nowhere, from every kind of start.
const filler = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~:;,".repeat(3);
function flat(text: string): string {
  text.charCodeAt(0);
  return text;
}
type Case = { text: string; value: any; from: number; right: number; first: number };
let wrong = 0;
function visit(cases: Case[], index: number): number {
  if (index >= cases.length) return 0;
  const one = cases[index];
  const typed = one.text.indexOf("/", one.from);
  const untyped = one.value.indexOf("/", one.from);
  const typedFirst = one.text.indexOf("/");
  const untypedFirst = one.value.indexOf("/");
  const has = one.value.includes("/");
  const hasTyped = one.text.includes("/");
  if (typed !== one.right || untyped !== one.right || typedFirst !== one.first || untypedFirst !== one.first || has !== one.first >= 0 || hasTyped !== has) wrong++;
  if (one.value.indexOf("é") !== -1 || one.text.indexOf("Ж") !== -1) wrong++;
  const rest = visit(cases, index + 1);
  return (rest * 31 + typed + untypedFirst + 4) % 1000000007;
}
function expected(text: string, from: number): number {
  for (let i = Math.max(from, 0); i < text.length; i++) if (text.charCodeAt(i) === 47) return i;
  return -1;
}
let sum = 0;
for (let length = 0; length <= 150; length++) {
  const base = filler.slice(0, length);
  const cases: Case[] = [];
  for (let place = -1; place < length; place += length > 70 ? 3 : 1) {
    let text = place < 0 ? flat(base + "") : flat(base.slice(0, place) + "/" + base.slice(place + 1));
    if (place >= 0 && place % 5 === 0 && place + 9 < length) text = flat(text.slice(0, place + 9) + "/" + text.slice(place + 10));
    for (const from of [0, 1, place, place + 1, 8, 15, 16, 17, length - 17, length - 16, length - 9, length - 8, length - 1, length + 3])
      cases.push({ text, value: text, from, right: expected(text, from), first: expected(text, 0) });
  }
  for (let start = 0; start < cases.length; start += 300) sum = (sum * 7 + visit(cases.slice(start, start + 300), 0)) % 1000000007;
}
console.log(wrong, sum);
