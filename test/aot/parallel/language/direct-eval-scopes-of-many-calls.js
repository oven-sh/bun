// Every direct eval gets scopes of its own, whatever the calls before it left behind: closures made by one call keep its bindings, and collections in between change nothing.
const text = {
  read: "x + y",
  write: "x = x + 1; y += 10; x + y",
  capture: "() => [x, y, ++x]",
  declare: "var made = x * 2; made + (typeof earlier)",
  nested: "eval('eval(\"x * y\")')",
  caught: "error + x",
  secret: "this.#hidden + other.#hidden",
};

function plain(x, source) {
  let y = x + 1;
  const result = eval(source);
  return [result, x, y];
}

function sloppyDeclarations(x, source) {
  const first = eval(source);
  const second = typeof made;
  return [first, second];
}

function inCatch(x, source) {
  try {
    throw "caught ";
  } catch (error) {
    return eval(source);
  }
}

class Vault {
  #hidden;
  constructor(value) { this.#hidden = value; }
  sum(other, source) { return eval(source); }
}

const kept = [];
for (let i = 0; i < 40; i++) {
  kept.push(plain(i, text.capture)[0]);
  if (i % 8 === 0) Bun.gc(true);
  if (i % 10 === 0) {
    console.log(
      plain(i, text.read).join(),
      plain(i, text.write).join(),
      plain(i, text.nested).join(),
      sloppyDeclarations(i, text.declare).join(),
      inCatch(i, text.caught),
      new Vault(i).sum(new Vault(100), text.secret),
    );
  }
}
Bun.gc(true);
console.log(kept.map(read => read().join("/")).filter((_, index) => index % 13 === 0).join(" "));
console.log(kept[3]().join("/"), kept[3]().join("/"), kept[4]().join("/"));
