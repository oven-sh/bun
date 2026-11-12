// Twelve functions take turns in one variable, and a property is read off whichever it holds. The types of the read value hold for all twelve.
// Under: --aot-check=FlowFixpoint: a read off a few functions asks each of them. Once the variable held more than a set names, the read was not resolved again, and the flow was not closed.
let state, seen;
const out = [], kept = [];
function s0() { state = s1; }
function s1() { state = s2; }
function s2() { state = s3; }
function s3() { state = s4; }
function s4() { state = s5; }
function s5() { state = s6; }
function s6() { state = s7; }
function s7() { state = s8; }
function s8() { state = s9; }
function s9() { state = s10; }
function s10() { state = s11; }
function s11() { state = s0; }
s9.tag = "nine";
s11.tag = 7;

class Box {
  v;
  constructor(v) { this.v = v; }
}
function show(v) { return v === undefined ? "none" : typeof v + v; }
function pass(v) { return show(v); }
function look() { seen = state.tag; }
function record() { return { v: state.tag, w: 1 }; }
function holder() {
  let held;
  return { look() { held = state.tag; }, show() { return held === undefined ? "none" : typeof held + held; } };
}
const captured = holder();

state = s0;
for (let i = 0; i < 14; i++) {
  look();
  captured.look();
  kept.push(state.tag);
  const box = new Box(state.tag), made = record();
  out.push([
    show(state.tag),
    seen === undefined ? "none" : typeof seen + seen,
    captured.show(),
    box.v === undefined ? "none" : typeof box.v + box.v,
    made.v === undefined ? "none" : typeof made.v + made.v,
    pass(state.tag),
  ].join(" "));
  state();
}
for (const v of kept) out.push(v === undefined ? "none" : typeof v + v);
console.log(out.join("\n"));

// A scanner whose states tell by a property how far they look ahead.
function scan(text) {
  let current, position = 0;
  const log = [];
  function start(c) { log.push("start" + c); current = open; }
  function open(c) { log.push("open" + c); current = name; }
  function name(c) { log.push("name" + c); current = attribute; }
  function attribute(c) { log.push("attribute" + c); current = value; }
  function value(c) { log.push("value" + c); current = quoted; }
  function quoted(c) { log.push("quoted" + c); current = after; }
  function after(c) { log.push("after" + c); current = close; }
  function close(c) { log.push("close" + c); current = comment; }
  function comment(c, ahead) { log.push("comment" + c + ahead); current = entity; }
  function entity(c, ahead) { log.push("entity" + c + ahead); current = done; }
  function done(c) { log.push("done" + c); current = start; }
  comment.ahead = 3;
  entity.ahead = "ab";
  current = start;
  while (position < text.length) {
    const ahead = current.ahead;
    if (typeof ahead === "number") {
      current(text[position], text.substring(position, position + ahead));
      position += ahead;
    } else if (typeof ahead === "string")
      current(text[position++], text.indexOf(ahead, position));
    else
      current(text[position++]);
  }
  return log;
}
console.log(scan("<abcdefgh-abxyzabcdefghijklmnop").join(" "));
