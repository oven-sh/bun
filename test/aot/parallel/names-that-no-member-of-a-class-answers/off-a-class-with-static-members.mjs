// The class has static members of its own, a field, and a class above with more.
class Base { static make() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "made"; } }
class Plain extends Base { static count = 3; static more() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "more"; } hello() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work; } }
function maker() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return Plain.constructor; }
let out = ""; try { for (let i = 0; i < 300; i++) out = String(maker()("return 7")()); } catch (e) { out = e.name; }
console.log(out, Plain.make(), Plain.more(), Plain.count, new Plain().hello());
