// The four URI functions of texts that they leave as they are, of texts that they change, of what they refuse and of what is no text.
const rope = JSON.parse('"abc"') + JSON.parse('"def-42"');
const cut = "/users/42/posts/7x".slice(7, 9);
const matched = /^\/users\/([^/]+)\/(.*)$/.exec("/users/al%20ice/p%2Fq");
const texts = ["", "42", "plain-text_1.~!*'()", "a b", "a%20b", "%", "%4", "%zz", "%E4%F6", "%C3%A4", "%F0%9F%98%80", "100%", "a+b", "a/b?c=d&e#f", ";,/?:@&=+$#", "ä", "日本", "\u{1F600}", "\uD800", "\uDC00x", "x\uD83D", "%25", "%2f%2F", "%00", "\0", "\x7f", "é%C3%A9", rope, cut, matched[1], matched[2], "A".repeat(300), "A".repeat(300) + "%41", "ü".repeat(40)];
const others = [undefined, null, 5, -0, 1.5, true, 10n, [], ["a%20b"], {}, { toString() { return "mine%21"; } }, { toString() { throw new RangeError("no"); } }, Symbol("s"), new String("w%41"), () => 1];
const functions = [decodeURI, decodeURIComponent, encodeURI, encodeURIComponent];
function one(x) { return decodeURIComponent(x); }
function two(x) { return encodeURIComponent(x); }
function three(x) { return decodeURI(x); }
function four(x) { return encodeURI(x); }
function inside(x) { try { return decodeURIComponent(x); } catch (error) { return "caught " + error.name; } }
const show = f => value => { try { const s = f(value); return typeof s + ":" + JSON.stringify(s); } catch (error) { return "throws " + error.name; } };
let lines = [];
for (let round = 0; round < 30; round++) lines = [one, two, three, four, inside].map(f => f.name + " " + texts.map(show(f)).join(" ") + " | " + others.map(show(f)).join(" "));
console.log(lines.join("\n"));
console.log(functions.map(f => [f(), f("a", "b"), ["x%41", "y"].map(f).join(), f.call({}, "z%42"), Reflect.apply(f, undefined, ["q r"])].join()).join(" | "));
const same = "stays"; console.log(decodeURIComponent(same) === same, encodeURIComponent(same) === same, Object.is(decodeURIComponent(cut), "42"), decodeURIComponent(cut).length);
