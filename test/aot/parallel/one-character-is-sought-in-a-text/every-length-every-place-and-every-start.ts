// One character is sought in texts of every length to 150: it stands at every place, twice, or nowhere; the search starts at every kind of place; by indexOf and includes, on a text whose type is written and on a value of which nothing is known.
const filler = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~:;,".repeat(3);
function flat(text: string): string {
  text.charCodeAt(0);
  return text;
}
const bag: { value: any } = { value: "" };
let sum = 0;
let wrong = 0;
function expected(text: string, from: number): number {
  for (let i = Math.max(from, 0); i < text.length; i++) if (text.charCodeAt(i) === 47) return i;
  return -1;
}
for (let length = 0; length <= 150; length++) {
  const base = filler.slice(0, length);
  for (let place = -1; place < length; place += length > 70 ? 3 : 1) {
    let text = place < 0 ? flat(base + "") : flat(base.slice(0, place) + "/" + base.slice(place + 1));
    if (place >= 0 && place % 5 === 0 && place + 9 < length) text = flat(text.slice(0, place + 9) + "/" + text.slice(place + 10));
    bag.value = text;
    for (const from of [0, 1, place - 1, place, place + 1, 7, 8, 15, 16, 17, length - 17, length - 16, length - 9, length - 8, length - 1, length, length + 3]) {
      const right = expected(text, from);
      const typed = text.indexOf("/", from);
      const untyped = bag.value.indexOf("/", from);
      if (typed !== right || untyped !== right) wrong++;
      sum = (sum * 31 + typed + 2) % 1000000007;
    }
    if (text.includes("/") !== (place >= 0) || bag.value.includes("/") !== (place >= 0)) wrong++;
    if (text.indexOf("Ж") !== -1 || bag.value.indexOf("é") !== -1) wrong++;
  }
}
console.log(wrong, sum);
