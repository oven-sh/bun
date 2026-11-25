// Flags: --define=PIECE=piece.length --define=COUNT=arguments.length --define=GREET=proto.greet --define=CALL=helper.call --define=LEVEL=local.level --define=__dirname=folder --define=NAMED=named --define=Box=box --define=ui.Box=box --define=PROMISES=fs.promises --define=SIZE=word.length --define=app.log=logger --drop=app.log.debug
// Reference: bun build --compile
/** @jsxRuntime classic @jsx h */
function appended() { let whole = "", seen = []; for (let i = 0; i < 2; i++) { let piece = ""; piece += "ab"; seen.push(PIECE); piece += "c"; whole += piece; } return seen + whole; }
function tail(n, extra) { if (n === 0) return COUNT; return tail(n - 1); }
const proto = { greet() { return "hi"; } };
const below = Object.create(proto), beside = Object.create(proto);
GREET = () => "changed";
CALL();
var mode = "set";
function helper() { console.log(mode, mode === "set"); }
const local = { level: "outer" };
function make() { return class { get() { return LEVEL; } }; }
const First = make();
{ const local = { level: "inner" }; const Second = make(); console.log(new First().get(), new Second().get(), local.level); }
const folder = "folder";
let named;
NAMED = function () {};
const h = tag => typeof tag;
function box() {}
function text() { return { LEVEL } }
console.log(appended(), tail(3, 1), below.greet(), beside.greet(), __dirname, named.name, <Box />, <ui.Box></ui.Box>);
console.log(text.toString().includes("LEVEL: local.level"), text().LEVEL);
globalThis.never = function () { const fs = PROMISES; return fs.readFile("never"); };
function early() { const read = () => SIZE, size = read(), word = "abc"; return size; }
function pattern(from, local) { ({ LEVEL = 7 } = from); return local.level; }
const logger = { debug: it => console.log(it), info: it => console.log(it) };
app.log.debug("dropped");
app.log.info("kept");
try { early(); } catch (e) { console.log(e.name); }
console.log(pattern({ LEVEL: 3 }, {}), pattern.toString().includes("LEVEL: local.level = 7"));
