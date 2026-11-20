// Under: --aot-testing=DelayFlowRules: one thread tells a program this small and got it right. On lanes what was stored on `holder` and `keeper` never reached the setters.
const holder = Object.create(null, { x: { set(v) { try { console.log(v("a")); } catch { console.log("threw"); } } } });
holder.x = function tail(text) { return text + "b"; };
class Box { constructor() { this.secret = 1; } }
const keeper = Object.create(null, { y: { set(v) { v.secret = "text"; } } });
const box = new Box(); keeper.y = box;
console.log(typeof box.secret, box.secret + 1);
