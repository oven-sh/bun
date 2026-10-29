// `text += rope`: a string that was joined and never read is still a rope when it is appended. Ropes of two and three pieces, of every length round the widths in which characters are copied,
// with pieces that are ropes or pieces of other strings themselves, with 16-bit pieces, into an empty text and into one that is nearly full, and the same rope again and again.
const lines: string[] = [];
const hide = <T,>(value: T): T => new CustomEvent("x", { detail: value }).detail;
const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(40);
const flat = (length: number, from = 0): string => hide(Buffer.from(letters.slice(from, from + length)).toString("latin1"));
const join2 = (a: string, b: string): string => hide(a) + hide(b);
const join3 = (a: string, b: string, c: string): string => hide(a) + hide(b) + hide(c);
function checksum(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + (sum >>> 0).toString(36);
}
function appended(start: string, pieces: string[]): string {
  let text = start;
  for (const piece of pieces) text += piece;
  return text;
}
function framed(id: number, title: string, price: number): string {
  let text = "";
  for (let i = 0; i < 3; i++) text += `${id},${title},${price}\n`;
  return text;
}

const lengths = [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 18, 31, 32, 33, 47, 48, 49, 63, 64, 65, 100, 127, 128, 129, 255, 256, 257, 600];
for (const a of lengths) {
  for (const b of [1, 2, 7, 8, 16, 17, 33, 200]) {
    const two = join2(flat(a), flat(b, 5));
    const three = join3(flat(b, 9), flat(a, 3), flat(1 + (a + b) % 19, 11));
    lines.push(`${a} ${b} ${checksum(appended("<", [two, ">"]))} ${checksum(appended("<", [three, two, three]))} ${checksum(appended("", [two, three]))} ${checksum(framed(a, two, b))}`);
    if (appended("<", [two, three]) !== "<" + letters.slice(0, a) + letters.slice(5, 5 + b) + letters.slice(9, 9 + b) + letters.slice(3, 3 + a) + letters.slice(11, 12 + (a + b) % 19)) lines.push("WRONG TEXT " + a + " " + b);
  }
}

// Pieces that are no flat 8-bit strings.
const nested = join2(join2(flat(3), flat(4, 1)), join3(flat(2, 2), join2(flat(5, 3), flat(1, 4)), flat(6, 5)));
const deep = [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((text, n) => join2(text, flat(n, n)), flat(2));
const pieceOfFlat = join2(hide(flat(40)).slice(3, 21), hide(flat(40, 7)).substring(30));
const wide = join2(flat(4), hide("Жя"));
const wideFirst = join3(hide("日本"), flat(9), flat(2));
const narrowTextInWideString = join2(hide("Жabcdefgh").slice(1), flat(3));
const single = join3(hide("x"), hide("y"), hide("z"));
for (const [name, rope] of Object.entries({ nested, deep, pieceOfFlat, wide, wideFirst, narrowTextInWideString, single })) {
  lines.push(`${name} ${appended("[", [rope, "]"])} ${appended("", [rope])} ${appended("[", [rope, rope, rope])} ${checksum(framed(1, rope, 2))}`);
}

// The rope is still what it was, and may be read afterwards.
const kept = join2(flat(12), flat(5, 20));
const before = appended("a", [kept, kept]);
lines.push(before, kept, String(kept.length), kept.charAt(13), appended("b", [kept]), String(kept === letters.slice(0, 12) + letters.slice(20, 25)));

// A text that grows past every capacity while ropes are appended.
let long = "start";
const unit = join3(flat(13), flat(21, 1), flat(8, 2));
for (let i = 0; i < 3000; i++) long += i % 7 === 0 ? join2(flat(1 + (i % 29)), flat(1 + (i % 13), 3)) : unit;
lines.push(checksum(long));

// Many times over the same objects, as a server does for each request.
type Product = { id: number; title: string; priceCents: number };
const products: Product[] = [];
for (let i = 0; i < 40; i++) products.push({ id: i + 1, title: join2("Product ", String(i + 1)), priceCents: 100 + i * 7 });
let total = 0;
const turns = Number(process.argv[2] ?? 200);
let last = "";
for (let turn = 0; turn < turns; turn++) {
  let text = "id,title,priceCents\n";
  for (const product of products) text += `${product.id},${product.title},${product.priceCents}\n`;
  total += text.length;
  last = text;
}
lines.push(String(total), checksum(last), last.slice(0, 60));
console.log(lines.join("\n"));
