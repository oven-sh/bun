const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Ok(v) { this.v = v; }
Ok.of = function (v) { return new Ok(typeof v === "string" ? v.length : v); };
Ok.tag = { kind: "ok", n: 1 };
const say = (x) => console.log(typeof x === "object" && x ? JSON.stringify(x) : String(x));
const o = { of: function (v) { return { v: "mine" }; } }; say(o["o" + "f"](1).v); say(Ok.of(2).v);
