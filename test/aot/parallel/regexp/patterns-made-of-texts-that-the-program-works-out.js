// The build goes through the code that makes these texts and lays code for them into the executable. What it lists claims nothing: a text that it did not foresee is compiled here.
const letters = String.raw`[a-zà-ÿ]`;
const inside = letters.slice(1, -1);
function widen(text) { return text.replace(/\\w/g, "[\\w" + inside + "]").replace(/\\d/g, "[0-9]"); }
function source(re) { if (!re) return null; if (typeof re === "string") return re; return re.source; }
function concat(...args) { return args.map(x => source(x)).join(""); }
function either(...args) { return "(?:" + args.map(x => source(x)).join("|") + ")"; }
const word = new RegExp(concat(/^/, either("ab+", /cd*/), "$"), "i");
const wide = new RegExp(widen(String.raw`^\w+:\d`), "u");

const re = [], src = [], t = {};
let next = 0;
const createToken = (name, value, isGlobal) => {
  const index = next++;
  t[name] = index;
  src[index] = value;
  re[index] = new RegExp(value, isGlobal ? "g" : undefined);
};
createToken("NUMBER", "0|[1-9]\\d*");
createToken("PAIR", `(${src[t.NUMBER]})-(${src[t.NUMBER]})`);
createToken("PAIRS", `${src[t.PAIR]}(?:,${src[t.PAIR]})*`, true);

let cache;
function lazy(text) {
  if (cache == null) cache = { one: new RegExp(`${letters}{3}|${wide.source}`, "gu"), two: new RegExp("^(?:" + letters + ")") };
  return [cache.one.test(text), cache.one.lastIndex, cache.two.test(text)];
}
const rules = [{ source: "a{2}x", flags: "g" }, { source: "b{3}y", flags: "gi" }, { source: letters + "z" }];
function compile(sticky) { return rules.map(rule => new RegExp(rule.source, sticky ? (rule.flags ?? "").replace("g", "") + "y" : rule.flags ?? "")); }
function list() { const parts = []; for (const rule of rules) parts.push(rule.source); return new RegExp(parts.join("|")); }
function matcher(prefix, text) { return new RegExp(prefix + text); }

// What the build cannot know, and what it foresees wrongly.
const count = process.argv.length;
const unknown = new RegExp("^.{" + (count > 100 ? 1 : 2) + "}$");
let prefix = "a";
function late() { return new RegExp(prefix + "+$"); }
prefix = count > 100 ? "b" : "c";
const changed = [];
changed.push("x");
if (count <= 100) changed[0] = "y";
const afterwards = new RegExp("^" + changed.join("") + "$");
function broken(text) { try { return new RegExp(text + "(").source; } catch (error) { return error.name; } }

console.log(word.source, word.flags, word.test("ABB"), word.test("cdd"), word.test("abc"));
console.log(wide.source, wide.test("é1:2"), wide.test("1:x"));
console.log(re.map(one => one.source + "/" + one.flags).join(" "), re[t.PAIR].exec("12-7").slice(1).join(), "1-2,3-4 5-6".match(re[t.PAIRS]).join(";"));
console.log(JSON.stringify([lazy("xyz"), lazy("q"), lazy("1")]));
for (const sticky of [true, false]) console.log(compile(sticky).map(one => `${one}:${one.test("zaaxBBBYqz")}:${one.lastIndex}`).join(" "));
console.log(String(list()), list().exec("--bbby")[0]);
console.log(String(matcher("^", "a+")), String(matcher("\\b", "c+")), matcher("\\b", "c+").exec("a cc")[0]);
console.log(String(unknown), unknown.test("ab"), String(late()), late().test("acc"), String(afterwards), afterwards.test("y"), broken("a"));
console.log(RegExp.lastMatch, RegExp["$&"], RegExp.leftContext);
