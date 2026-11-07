// Prints the caller of a toString() that throws, where a text is put together in several statements: `bun run` evaluates a value that is used once where its variable is named, and several `+` in a row that make a text are one concatenation.
function show(run) {
  try {
    run();
    console.log(run.name + " no error");
  } catch (error) {
    const frames = String(error && error.stack).split("\n").slice(1, 3);
    console.log(run.name + " " + (error && error.constructor.name) + " " + frames.map(line => line.replace(/.*:(\d+:\d+)\)?$/, "$1").replace(/^\s*at /, "")).join(" < "));
  }
}
const hide = value => [value, 0][Number(process.argv.length > 100)];
const x = hide("x"), y = hide("y"), n = hide(1), T = { toString() { throw new Error("written"); } };
show(function a1() { const t = "a" + T; return t + "b"; });
show(function a2() { const t = "a" + x; return t + T; });
show(function a3() { const t = x + "a"; return t + T; });
show(function a4() { const t = x + y; return t + T; });
show(function a5() { const t = T + "a"; return t + "b"; });
show(function a6() { const t = "a" + T; return t + x + "b"; });
show(function a7() { const t = "a" + T; const u = t + "b"; return u + "c"; });
show(function a8() { const t = "a" + x; return "b" + t + T; });
show(function a9() { const t = `a${x}`; return t + T; });
show(function b1() { const t = "a" + x; let s = "s"; s += t + T; return s; });
show(function b2() { const t = "a" + x + T; return t + "b"; });
show(function b3() { const t = x + T; return t + "b"; });
show(function b4() { const t = x + T; return t + y; });
show(function b5() { const t = n + T; return t + "b"; });
show(function b6() { const t = "a" + x; return t + y + T; });
show(function b7() { const t = "a" + x; return (t + y) + T; });
show(function b8() { const t = "a" + x; return t + (y + T); });
show(function b9() { const t = typeof x + T; return t + "b"; });
show(function c1() { const t = "a" + x; const u = t + y; return u + T; });
show(function c2() { const t = "a" + x; return use(t + T); });
show(function c3() { const t = "a" + T; return [t + "b"]; });
show(function c4() { const t = "a" + T; return `${t + "b"}`; });
show(function c5() { const t = "a" + T; return t + "b" + "c"; });
show(function c6() { const t = x + "a"; return t + "b" + T; });
show(function c7() { let t = "a" + T; return t + "b"; });
show(function c8() { const t = "a" + T; return t + 1; });
show(function c9() { const t = "a" + T; return t + n; });
function use(value) { return value; }
show(function keptText() { const text = "a" + T; return text + "b"; });
show(function keptTextRight() { const text = T + "a"; return "b" + text; });
show(function keptTextTwice() { const text = "a" + T; const more = text + "b"; return more + "c"; });
show(function keptTemplate() { const text = `a${T}`; return text + "b"; });
show(function keptTextInTemplate() { const text = "a" + T; return `${text}b`; });
show(function keptName(name = "n") { const text = name + T; return text + "b"; });
show(function keptNameThree(name = "n") { const text = name + "a" + T; return text + "b"; });
