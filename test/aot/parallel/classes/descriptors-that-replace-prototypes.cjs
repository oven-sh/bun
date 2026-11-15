// A descriptor with a value, or one that somebody else writes, replaces the prototype; a flag alone does not.
"use strict";
var flags = { writable: process.argv.length > 100 };
function value(t, e) { Object.defineProperty(t, "prototype", { value: Object.create(e.prototype), writable: flags.writable }); }
function given(t, e, d) { Object.defineProperty(t, "prototype", d); t.parent = e; }
function alone(t, e) { Object.defineProperty(t, "prototype", { writable: flags.writable }); t.parent = e; }
function getter(t, e) { try { Object.defineProperty(t, "prototype", { get: function () { return e.prototype; } }); } catch (x) { t.failed = x instanceof TypeError; } }
function result(t, e) { var r = Object.defineProperty(t, "above", { value: e, writable: true }); r.prototype.own = 1; return r; }
function P(a) { this.a = a; } P.prototype.get = function () { return "p" + this.a; };
function Q(b) { this.b = b; } Q.prototype.get = function () { return "q" + this.b; };
var made = [];
[value, function (t, e) { given(t, e, { value: e.prototype }); }, function (t, e) { given(t, e, { writable: false }); }, alone, getter, result].forEach(function (link, n) {
    function H(x) { P.call(this, x); } H.prototype.get = function () { return "h" + this.a; };
    function K(x) { Q.call(this, x); } K.prototype.get = function () { return "k" + this.b; };
    made.push(link(H, P), link(K, Q));
    for (var i = 0; i < 5; i++) { var h = new H(i), k = new K(i); }
    console.log(n, h.get(), k.get(), h instanceof P, k instanceof P, k instanceof Q, H.parent === P, H.failed, H.above === P, h.own, Object.getPrototypeOf(h) === H.prototype);
    try { H.prototype = { get: function () { return "late"; } }; } catch (e) { console.log(e instanceof TypeError); }
    console.log(new H(9).get(), new K(9).get());
});
console.log(made.map(function (m) { return typeof m; }).join());
