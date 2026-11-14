// STATISTIC: FieldsTakenForIntegers >= 2
// What a loop reads off an object of a class that code out of sight may change, and compares with an integer, is an integer.
function keep(table, key, value) { table[key] = value; }
var T;
(function (T) {
  T.End = -1; T.Space = 32; T.Slash = 47;
  var Scanner = (function () {
    function Scanner() { this.position = 0; this.length = 0; this.code = T.End; this.spaces = 0; this.slashes = 0; this.others = 0; }
    Scanner.prototype.setText = function (source) { this.source = source; this.length = source.length; this.position = 0; };
    Scanner.prototype.peek = function () { if (this.position < this.length) { return this.source.charCodeAt(this.position); } else { return T.End; } };
    Scanner.prototype.next = function () { this.position++; this.code = this.peek(); };
    Scanner.prototype.scan = function () {
      this.code = this.peek();
      while (this.position < this.length) {
        if (this.code == T.Space) { do { this.spaces++; this.next(); } while (this.code == T.Space) }
        else if (this.code == T.Slash) { this.next(); this.slashes++; }
        else { this.next(); this.others++; }
      }
      return [this.spaces, this.slashes, this.others].join();
    };
    return Scanner;
  })();
  T.Scanner = Scanner;
})(T || (T = {}));
keep(globalThis, 'kept' + process.argv.length, T.Scanner);
function scan(source) { var scanner = new T.Scanner(); scanner.setText(source); try { return scanner.scan(); } catch (error) { return error.name; } }
console.log(scan('a b  /c/ d'), scan(' '), scan('///'), scan(''));
function odd(codes) { return scan({ length: codes.length, charCodeAt: function (at) { return codes[at]; } }); }
console.log(odd([32, 47, 97]), odd(['32', '47', '97']), odd([32.5, 47, 32]), odd([{ valueOf: function () { return 32; } }, 47]), odd([NaN, undefined, null, -0, 32n, true]), odd([[32], [47], '-1', 5]), odd([Symbol.iterator, 32]), odd(new Proxy([32, '47'], {})));
var accessor = new T.Scanner(); Object.defineProperty(accessor, 'code', { get: function () { return this.held; }, set: function (code) { this.held = code; }, configurable: true }); accessor.setText('a /'); console.log(accessor.scan(), accessor.held);
var bare = new T.Scanner(); delete bare.code; bare.setText(' /b'); console.log(bare.scan(), bare.code); Object.freeze(bare); try { console.log(bare.scan()); } catch (error) { console.log(error.name); }
