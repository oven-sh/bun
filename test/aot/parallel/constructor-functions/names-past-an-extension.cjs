// STATISTIC: FlowAppendedFields >= 74
// A namespace object gets more names than an extension holds: classes, functions and numbers among the last of them are read in loops.
var NS;
(function (NS) {
  NS.N0 = 0; NS.N1 = 1; NS.N2 = 2; NS.N3 = 3; NS.N4 = 4; NS.N5 = 5; NS.N6 = 6; NS.N7 = 7; NS.N8 = 8; NS.N9 = 9;
  NS.N10 = 10; NS.N11 = 11; NS.N12 = 12; NS.N13 = 13; NS.N14 = 14; NS.N15 = 15; NS.N16 = 16; NS.N17 = 17; NS.N18 = 18; NS.N19 = 19;
  NS.N20 = 20; NS.N21 = 21; NS.N22 = 22; NS.N23 = 23; NS.N24 = 24; NS.N25 = 25; NS.N26 = 26; NS.N27 = 27; NS.N28 = 28; NS.N29 = 29;
  NS.N30 = 30; NS.N31 = 31; NS.N32 = 32; NS.N33 = 33; NS.N34 = 34; NS.N35 = 35; NS.N36 = 36; NS.N37 = 37; NS.N38 = 38; NS.N39 = 39;
  NS.N40 = 40; NS.N41 = 41; NS.N42 = 42; NS.N43 = 43; NS.N44 = 44; NS.N45 = 45; NS.N46 = 46; NS.N47 = 47; NS.N48 = 48; NS.N49 = 49;
})(NS || (NS = {}));
(function (NS) {
  NS.M0 = 'a'; NS.M1 = 'b'; NS.M2 = 'c'; NS.M3 = 'd'; NS.M4 = 'e'; NS.M5 = 'f'; NS.M6 = 'g'; NS.M7 = 'h'; NS.M8 = 'i'; NS.M9 = 'j';
  NS.M10 = 'k'; NS.M11 = 'l'; NS.M12 = 'm'; NS.M13 = 'n'; NS.M14 = 'o'; NS.M15 = 'p'; NS.M16 = 'q'; NS.M17 = 'r'; NS.M18 = 's'; NS.M19 = 't';
  var Scanner = (function () {
    function Scanner(text) { this.text = text; this.pos = 0; this.ch = NS.End; }
    Scanner.prototype.next = function () { this.ch = this.pos < this.text.length ? this.text.charCodeAt(this.pos++) : NS.End; return this.ch; };
    return Scanner;
  })();
  NS.Scanner = Scanner;
  function isSpace(ch) { return ch === NS.Space; }
  NS.isSpace = isSpace;
  NS.End = -1;
  NS.Space = 32;
})(NS || (NS = {}));
function words(text) {
  var scanner = new NS.Scanner(text), count = 0, inside = false;
  while (scanner.next() !== NS.End) {
    if (NS.isSpace(scanner.ch)) inside = false;
    else if (!inside) { inside = true; count++; }
  }
  return count;
}
console.log(words('one two  three four'), words(''), words(' x '));
console.log(NS.N49 + NS.N0, NS.M19, NS.missing, NS.Space);
NS.Space = 97;
console.log(words('banana'));
// A record that is made in a loop keeps its extension.
function fill(o, i) { if (i > 1) o.late = i; o.k = i; return o; }
var all = [];
for (var i = 0; i < 3; i++) all.push(fill({}, i));
console.log(all.map(function (o) { return o.k + (o.late || 0); }).join());
