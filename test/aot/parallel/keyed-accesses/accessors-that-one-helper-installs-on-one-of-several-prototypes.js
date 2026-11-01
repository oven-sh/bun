// One helper installs accessors on whatever prototype it is given, under every name of whatever table it is given.
// A store below runs the setter where the accessor really stands above, and makes a property where it does not.
const lines = [];
function say(label, value) { lines.push(label + ": " + value); }
function install(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() { return fn.call(this) + " (got)"; },
    set(value) { Object.defineProperty(this, key, { value: "set " + value, writable: true, configurable: true, enumerable: true }); },
  });
}
function members(proto, table) { for (const key in table) install(proto, key, table[key]); }

function Internals(def) { this.def = def; }
const internalsProto = {};
Internals.prototype = internalsProto;
function Plain(def) { this.def = def; }
class Schema { constructor(def) { this.def = def; } }
const which = JSON.parse('{"schema":0,"internals":1,"plain":2}');
const protos = [Schema.prototype, internalsProto, Plain.prototype];
members(protos[which.schema], { check() { return "schema check of " + this.def; }, parse() { return "schema parse of " + this.def; } });
members(protos[which.internals], { parse() { return "internals parse of " + this.def; } });

function show(item) { return item.check + " | " + item.parse + " | " + Object.keys(item); }
function fill(item, check, parse) { item.check = check; item.parse = parse; return item; }

const first = new Internals("first");
say("internals before", show(first));
say("internals after", show(fill(first, "a check", "a parse")));
say("internals again", show(fill(first, "another check", "another parse")));
const plain = new Plain("plain");
say("plain before", show(plain));
say("plain after", show(fill(plain, "a check", "a parse")));
const schema = new Schema("schema");
say("schema before", show(schema));
say("schema after", show(fill(schema, "a check", "a parse")));

let text = "";
for (let i = 0; i < 3000; i++) {
  const item = fill(i % 3 === 0 ? new Internals(i) : i % 3 === 1 ? new Plain(i) : new Schema(i), i, -i);
  if (i % 997 === 0 || i % 997 === 1 || i % 997 === 2) text += show(item) + "; ";
}
say("many", text);

const early = fill(new Plain("early"), "kept check", "kept parse");
members(protos[which.plain], { check() { return "late check of " + this.def; }, more() { return "more of " + this.def; } });
const late = new Plain("late");
say("installed late, before", show(late) + " | " + late.more);
say("installed late, after", show(fill(late, "a check", "a parse")));
late.more = "stored";
say("installed late, more", late.more + " | " + Object.keys(late));
say("made earlier", show(early) + " | " + early.more);
say("made earlier, stored again", show(fill(early, "new check", "new parse")));
delete early.check;
say("made earlier, deleted", show(early));
say("made earlier, stored once more", show(fill(early, "last check", "last parse")));

delete internalsProto.parse;
const bare = new Internals("bare");
say("accessor deleted, before", show(bare));
say("accessor deleted, after", show(fill(bare, "a check", "a parse")));
console.log(lines.join("\n"));
