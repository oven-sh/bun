// Object.keys, getOwnPropertyNames and Reflect.ownKeys of literals: with names added, deleted, redefined, hidden, computed, copied, inherited, and in other hands.
const lines = [];
const show = (label, object) => {
  const parts = [];
  for (const key of Object.keys(object)) parts.push(key + "=" + typeof object[key]);
  lines.push(label + ": " + parts.join() + " | " + Object.getOwnPropertyNames(object).join() + " | " + Reflect.ownKeys(object).map(String).join());
};
const plain = { run: () => "run", stop: () => "stop", limit: 3 };
show("plain", plain);
for (const key of Object.keys(plain)) lines.push(typeof plain[key] === "function" ? plain[key]() : plain[key] + 1);

const grown = { first: 1 };
grown.second = "two";
grown["third"] = () => 3;
show("grown", grown);

const shrunk = { kept: 1, dropped: 2 };
delete shrunk.dropped;
show("shrunk", shrunk);

const hidden = { seen: 1 };
Object.defineProperty(hidden, "unseen", { value: () => "unseen", enumerable: false });
Object.defineProperty(hidden, "computed", { get: () => "got", enumerable: true });
show("hidden", hidden);
lines.push(hidden.unseen(), hidden.computed);

const mark = Symbol("mark");
const marked = { [mark]: 1, named: 2, 7: "seven", "08": "text" };
show("marked", marked);

const name = "made" + lines.length;
const byText = { fixed: 1 };
byText[name] = () => "made at run time";
show("byText", byText);
for (const key of Object.keys(byText)) if (typeof byText[key] === "function") lines.push(byText[key]());

const copied = { own: 1 };
Object.assign(copied, plain, { extra: () => "extra" });
show("copied", copied);
const spread = { ...plain, more: 1 };
show("spread", spread);

const above = { inherited: () => "inherited" };
const below = Object.create(above);
below.own = () => "own";
show("below", below);
const literalBelow = { __proto__: above, mine: 1 };
show("literalBelow", literalBelow);
for (const key in literalBelow) lines.push("in " + key);

const handedOut = { before: 1 };
new Function("object", "object.added = () => 'added by evaluated text'; delete object.before;")(handedOut);
show("handedOut", handedOut);
for (const key of Object.keys(handedOut)) lines.push(handedOut[key]());

function fill(target, names) {
  for (const key of names) target[key] = () => key;
  return target;
}
const filled = fill({}, Object.keys(plain));
show("filled", filled);
lines.push(filled.run(), filled.stop(), filled.limit());

const frozen = Object.freeze({ a: 1, b: 2 });
show("frozen", frozen);
const watched = new Proxy({ real: 1 }, { ownKeys: () => ["real", "made up"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) });
show("watched", watched);
show("array", ["x", "y"]);
show("text", Object("ab"));
console.log(lines.join("\n"));
