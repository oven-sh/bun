class Above { who() { return "above"; } get twice() { return "aa"; } static kind() { return "Above"; } }
class Below extends Above { own() { return this.who() + this.twice; } }
function use(o) { return o.own(); }
Above.prototype.who = function () { return "changed"; };
Object.defineProperty(Above.prototype, "twice", { get() { return "cc"; }, configurable: true });
Above.kind = () => "Changed";
let text = "";
for (let i = 0; i < 3; i++) text += use(new Below()) + Below.kind();
console.log(text);
delete Above.prototype.who;
try { use(new Below()); } catch (e) { console.log(e instanceof TypeError); }
