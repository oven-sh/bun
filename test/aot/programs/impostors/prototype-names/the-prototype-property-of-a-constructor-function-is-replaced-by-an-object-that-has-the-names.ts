// `F.prototype = other` after 3000 constructions: old instances keep the old prototype object, new ones get the new one, and both kinds go through the same typed functions.
// The new object has a value and accessors under the names of late fields. Later the old object gets them too, and objects made by Object.create join in.
interface Token {
  kind: number;
  text?: string;
  width?: number;
}
function Token(this: Token, kind: number) {
  this.kind = kind;
}
const TokenClass = Token as any as new (kind: number) => Token;
const log: string[] = [];
function textOf(token: Token) {
  return token.text;
}
function setText(token: Token, value: string) {
  token.text = value;
}
function widthOf(token: Token) {
  return (token.width ??= token.kind * 2);
}
function state(token: Token) {
  return `${textOf(token)} ${token.width} ${token instanceof TokenClass} [${Object.keys(token)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) {
  const token = new TokenClass(i & 7);
  length += textOf(token)?.length ?? 1;
  if (i & 1) setText(token, "ab");
  if (i & 2) length += widthOf(token);
  length += state(token).length;
}
console.log("warm", length);

const first: any = (Token as any).prototype;
const old = new TokenClass(1);
const replacement = {
  constructor: Token,
  width: 99,
  get text() {
    return "text from the new prototype";
  },
  set text(value: string) {
    log.push("text = " + value);
  },
};
(Token as any)[["proto", "type"].join("")] = replacement;
const young = new TokenClass(2);
const bare: Token = Object.create(first);
bare.kind = 3;
const bareYoung: Token = Object.create(replacement);
bareYoung.kind = 4;
const all = () => [old, young, bare, bareYoung].map(state).join(" | ");
console.log("replaced:", all());
for (const token of [old, young, bare, bareYoung]) setText(token, "stored");
console.log("stored:", all(), "|", log.join(", "));
console.log("widths:", [old, young, bare, bareYoung].map(widthOf).join(), "|", all());
log.length = 0;
first.width = 11;
Object.defineProperty(first, "text", { set: value => void log.push("old prototype: " + value), configurable: true });
const oldToo = Reflect.construct(TokenClass, [5], Object.assign(function () {}, { prototype: first })) as Token;
console.log("the old one gets them too:", state(oldToo), widthOf(oldToo));
setText(oldToo, "x");
delete old.text;
setText(old, "y");
console.log("stored:", state(oldToo), "|", state(old), "|", log.join(", "));
(Token as any).prototype = first;
delete first.width;
delete first.text;
console.log("put back and cleaned:", state(new TokenClass(6)), "|", state(young), "|", state(oldToo));
