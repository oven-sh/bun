// An untyped package and a program of it (old records): records whose fields begin as small integers and become fractions, large, missing, texts or big on later turns
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var os = []; for (var i = 0; i < 12; i++) os.push(new lib.Old(i % 3 ? i : i * 1e9, i % 4 === 3 ? 0.25 : i)); for (var n = 0; n < 5; n++) os.forEach(function (o, i) { if (n === 2 && i === 4) delete o.b; if (n === 3 && i === 5) o.a = 'q'; if (n === 3 && i === 6) o.b = 10n; var r; try { r = o.next(); } catch (e) { r = e.name; } say(n, i, String(r), String(o.a), String(o.b), o.mark('m' + n, i), o.mark('z', i % 2 ? 0.5 : 2147483647), Object.keys(o).join('')); }); say(String(lib.sum(os, 'a')), lib.sum(os, 'm1'), lib.Old.zero.next(), lib.Old.zero.a, JSON.stringify(Object.assign(new lib.Old(1, 2), { a: 1.5, d: -0 })), 1 / Object.assign({}, { d: -0 }).d);
