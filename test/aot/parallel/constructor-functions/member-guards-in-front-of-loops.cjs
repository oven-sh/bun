// The guards of members are asked in front of a loop: a member that changes in front of it, in a turn, or in what a turn calls, is found as it stands.
function B(n) { this.n = n; this.i = 0; }
B.prototype.step = function () { this.i = (this.i + 1) & 1023; return this.i; };
B.prototype.get = function () { return this.n; };
function make(own) { function Child(n) { B.call(this, n); } Child.prototype = Object.create(B.prototype); Child.prototype.own = own; return Child; }
function D(n) { B.call(this, n); }
D.prototype = Object.create(B.prototype);
D.prototype.own = function () { return this.get(); };
function E(n) { B.call(this, n); }
E.prototype = Object.create(B.prototype);
E.prototype.own = function () { return this.get() + 100; };
function G(n) { D.call(this, n); }
G.prototype = Object.create(D.prototype);
var ofD = [new D(1), new D(2)], ofBoth = [new D(1), new E(2)], ofThree = [new D(1), new E(2), new G(3), new B(4)];
function runD(k) { var s = 0; for (var i = 0; i < k; i++) { var d = ofD[i & 1]; s = s + d.step() + d.own(); } return s; }
function runBoth(k) { var s = 0; for (var i = 0; i < k; i++) { var d = ofBoth[i & 1]; s = s + d.step() + d.get(); } return s; }
function runThree(k) { var s = ''; for (var i = 0; i < k; i++) { var d = ofThree[i & 3]; s = s + d.step() + d.get(); } return s; }
function runChanging(k, at, change) { var s = ''; for (var i = 0; i < k; i++) { var d = ofBoth[i & 1]; s = s + ',' + d.step(); if (i === at) change(); s = s + d.get() + d.own(); } return s; }
function runStoring(k, at) { var s = ''; for (var i = 0; i < k; i++) { var d = ofBoth[i & 1]; s = s + ',' + d.step(); if (i === at) D.prototype.get = function () { return 'd'; }; s = s + d.get(); } return s; }
function report(what) { console.log(what, runD(6), runBoth(6), runThree(8)); }
report('first');
console.log(runChanging(6, 2, function () { E.prototype.own = function () { return 'E'; }; }));
report('own of E');
console.log(runChanging(6, 3, function () { B.prototype.get = function () { return this.n * 10; }; }));
report('get of B');
console.log(runStoring(6, 2));
report('get of D');
D.prototype.step = function () { return 0.5; };
report('step of D');
ofThree[1].step = function () { return 'own'; };
report('step of an object');
Object.setPrototypeOf(E.prototype, { step: function () { return -1; }, get: function () { return -2; } });
report('parent of E');
delete D.prototype.get;
report('get of D again');
Object.defineProperty(B.prototype, 'get', { get: function () { return function () { return 'g'; }; } });
report('a getter');
var Other = make(function () { return 'other'; }), Another = make(function () { return 'another'; });
ofBoth = [new Other(1), new Another(2)];
console.log(runChanging(4, 1, function () { Other.prototype.own = function () { return 'changed'; }; }));
ofD = [new Other(5), new D(6)];
report('others');
