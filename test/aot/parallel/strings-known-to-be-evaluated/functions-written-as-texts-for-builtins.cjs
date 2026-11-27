// Methods that a file lays on built-in prototypes build the text of a function and evaluate its assignment: the texts that the constants of the file lead to are known to the build, others come only at run time; all do what their text says.
String.prototype.maker = function (body) { const name = 'm' + this.length; eval('String.prototype.' + name + " = function (n) { return this + '" + body + "' + n; };"); return name; };
Array.prototype.adder = function (by) { let text = 'Array.prototype.add' + by + ' = function () { let s = 0; for (let i = 0; i < this.length; i++) s += this[i] + ' + by + '; return s; };'; eval(text); return this['add' + by](); };
Number.prototype.inBase = function (base) { eval('Number.prototype.as' + base + ' = function () { return this.toString(' + base + ') + "/' + base + '"; };'); return this['as' + base](); };
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
console.log('abc'.maker('-'), 'x'.m3(4), [1, 2, 3].adder(5), [4].add5(), (255).inBase(16), (16).as16(), (3).inBase(2));
const arrived = JSON.parse('["zz", 7, 36]');
console.log('abcde'.maker(arrived[0]), 'q'.m5(1), [1, 1].adder(arrived[1]), [2].add7(), (35).inBase(arrived[2]));
console.log(say(() => 'ab'.maker("' + missing + '")), say(() => 'y'.m2(1)), say(() => [1].adder('1 + ')), say(() => [1].adder('(() => { throw new RangeError(1); })()')));
Object.defineProperty(String.prototype, 'm6', { set(f) { this.got = typeof f; String.kept = f; }, get() { return 'a getter'; }, configurable: true }); console.log('sixsix'.maker('!'), ''.m6, String.kept.call('in', 2));
Object.freeze(Number.prototype); console.log(say(() => (1).inBase(3)), say(() => (1).as16()));
(function () { var place = 0, text = 'place = function (n) { return n + 1; }'; eval(text); console.log(place(1)); eval('place = 3'); console.log(place); const other = eval; other('var outer1 = 5'); console.log(outer1, eval('place + 1'), other('typeof place')); })();
for (let i = 0; i < 40; i++) (i % 3).inBase === undefined || [i].add5(); console.log([40].add5(), say(() => eval('String.prototype.m3 = 5; "x".m3(1)')), 'y'.m3);
