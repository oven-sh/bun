function ctorOf(f) { return f.constructor; }
const makers = [ctorOf(function () {}), ctorOf(function* () {})];
try { console.log(makers[0]("return 6 * 7")()); } catch (e) { console.log(e.name); }
