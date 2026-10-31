// `object["$" + name]`: the key begins with a text that is written out. It finds what begins so, whoever put it there.
const lines = [];
function say(label, value) { lines.push(label + ": " + value); }
function text(value) { return typeof value === "function" ? "function " + value.name : typeof value === "object" && value ? JSON.stringify(value) : String(value); }
const parts = JSON.parse('{"x":"x","empty":"","structor":"structor","to__":"to__","String":"String","one":"1","amp":"&","OwnProperty":"OwnProperty","type":"type","gth":"gth","e":"e"}');

function clash(table, name, kind) {
  name = "$" + name;
  let other = table[name];
  let clashes = false;
  if (other) clashes = other[kind]; else other = table[name] = { init: false, get: false, set: false };
  other[kind] = true;
  return clashes;
}
const table = {};
say("table", [clash(table, "a", "init"), clash(table, "a", "get"), clash(table, "a", "init"), clash(table, "constructor", "set"), clash(table, "__proto__", "get"), clash(table, "__proto__", "get")].join(",") + " " + Object.keys(table).join(","));

const plain = { $x: 1, constructed: 2 };
say("finds its own", text(plain["$" + parts.x]) + " " + text(plain["$" + parts.empty]) + " " + text(plain["con" + parts.structor + "ed"]));
say("members of Object.prototype", text(plain["con" + parts.structor]) + " " + text(plain["to" + parts.String]) + " " + text(plain["has" + parts.OwnProperty]) + " " + (plain["__pro" + parts.to__] === Object.prototype) + " " + text(plain["c" + "on" + parts.structor]));
plain["con" + parts.structor].marked = "stored into Object";
say("stored into what it found", Object.marked);
delete Object.marked;

class Holder { $method() { return "method of " + this.constructor.name; } get $getter() { return "getter"; } static $fixed = "static"; }
const holder = new Holder();
say("class", holder["$" + "method"]() + " " + holder["$" + parts.empty + "method"]() + " " + holder["$get" + "ter"] + " " + Holder["$" + "fixed"] + " " + text(holder["con" + parts.structor]) + " " + text(Holder["proto" + parts.type] === Object.getPrototypeOf(holder)));
function Made() { this.$own = 1; }
Made.prototype.$above = function above() { return "above"; };
say("constructor function", new Made()["$" + "above"]() + " " + new Made()["$o" + "wn"] + " " + text(new Made()["con" + parts.structor]) + " " + text(Made["nam" + parts.e]) + " " + text(Made["len" + parts.gth]));

const hidden = {};
Object.defineProperty(hidden, "$hidden", { value: function hiddenOne() { return "hidden"; }, enumerable: false });
say("not enumerable", hidden["$" + "hidden"]());
"ab".match(/(a)(b)/);
say("RegExp", RegExp["$" + parts.one] + " " + RegExp["$" + parts.amp]);
const belowRegExp = Object.create(RegExp);
function attempt(read) { try { return read(); } catch (error) { return error.constructor.name; } }
say("below RegExp", attempt(() => belowRegExp["$" + parts.one]));
const turned = { $mine: 1 };
Object.setPrototypeOf(turned, RegExp);
say("turned to RegExp", attempt(() => turned["$" + parts.one]) + " " + turned["$" + "mine"]);
say("list", text([1, 2]["len" + parts.gth]) + " " + text([1, 2]["1" + parts.empty]) + " " + text({ 12: "twelve" }["1" + "2"]) + " " + text("text"["len" + parts.gth]));
const handlers = { onOpen() { return "opened"; }, onClose() { return "closed"; }, off() { return "off"; } };
say("handlers", ["Open", "Close", "Nothing"].map(kind => { const handler = handlers["on" + kind]; return handler ? handler() : "none"; }).join(","));
const proxy = new Proxy({}, { get(target, name) { return "asked for " + name; } });
say("proxy", proxy["$" + parts.x]);
say("numbers in front", text({ "1x": "one x" }[1 + parts.x]) + " " + text({ 3: "three" }[1 + 2]));
console.log(lines.join("\n"));
