// Properties and elements added to the same objects by turns. Twenty properties are added to objects of 36 kinds in eleven ways (fields with written names, computed names and symbols, private fields and
// methods, stores), at code that has done it before; an element is stored ahead of the first addition, or elements are stored between the additions (ahead of the fourth, seventh, eighth and eleventh): an integer, one
// behind a hole, a double, an object, one far out, five in a row, one that is read-only, a length of zero, a push. The objects are made six in a row, side by side, and all six are looked at when all six are done:
// a write that misses its object lands in a neighbour. What is printed is a sum over what every element, every property and the object itself say; plain Bun's is what is expected.
var part = 0, parts = 1;
var current = null, between = null;
function step(i) { if (between && (i === 3 || i === 6 || i === 7 || i === 10)) between(current, i); return i; }
class Stamp { constructor(o) { return o; } }
var texts = [], symbols = [];
for (var i = 0; i < 20; i++) { texts.push("key" + i); symbols.push(Symbol("s" + i)); }
class ByName extends Stamp { a = step(0); b = step(1); c = step(2); d = step(3); e = step(4); f = step(5); g = step(6); h = step(7); i = step(8); j = step(9); k = step(10); l = step(11); m = step(12); n = step(13); o = step(14); p = step(15); q = step(16); r = step(17); s = step(18); t = step(19); }
class ByText extends Stamp { [texts[0]] = step(0); [texts[1]] = step(1); [texts[2]] = step(2); [texts[3]] = step(3); [texts[4]] = step(4); [texts[5]] = step(5); [texts[6]] = step(6); [texts[7]] = step(7); [texts[8]] = step(8); [texts[9]] = step(9); [texts[10]] = step(10); [texts[11]] = step(11); [texts[12]] = step(12); [texts[13]] = step(13); [texts[14]] = step(14); [texts[15]] = step(15); [texts[16]] = step(16); [texts[17]] = step(17); [texts[18]] = step(18); [texts[19]] = step(19); }
class BySymbol extends Stamp { [symbols[0]] = step(0); [symbols[1]] = step(1); [symbols[2]] = step(2); [symbols[3]] = step(3); [symbols[4]] = step(4); [symbols[5]] = step(5); [symbols[6]] = step(6); [symbols[7]] = step(7); [symbols[8]] = step(8); [symbols[9]] = step(9); [symbols[10]] = step(10); [symbols[11]] = step(11); [symbols[12]] = step(12); [symbols[13]] = step(13); [symbols[14]] = step(14); [symbols[15]] = step(15); [symbols[16]] = step(16); [symbols[17]] = step(17); [symbols[18]] = step(18); [symbols[19]] = step(19); }
class Private extends Stamp { #a = step(0); #b = step(1); #c = step(2); #d = step(3); #e = step(4); #f = step(5); #g = step(6); #h = step(7); #i = step(8); #j = step(9); #k = step(10); #l = step(11); #m = step(12); #n = step(13); #o = step(14); #p = step(15); #q = step(16); #r = step(17); #s = step(18); #t = step(19); static read(o) { return [o.#a, o.#b, o.#c, o.#d, o.#e, o.#f, o.#g, o.#h, o.#i, o.#j, o.#k, o.#l, o.#m, o.#n, o.#o, o.#p, o.#q, o.#r, o.#s, o.#t]; } }
class PrivateMethods extends Stamp { #a() { return 0; } #b() { return 1; } #c() { return 2; } #d() { return 3; } #e() { return 4; } #f() { return 5; } #g() { return 6; } #h() { return 7; } #i() { return 8; } static read(o) { return [o.#a(), o.#b(), o.#c(), o.#d(), o.#e(), o.#f(), o.#g(), o.#h(), o.#i()]; } }
class Mixed extends Stamp { #p = step(0); a = step(1); [texts[2]] = step(2); #m() { return 3; } [symbols[4]] = step(4); #q = step(5); g = step(6); [texts[7]] = step(7); #r = step(8); j = step(9); [symbols[10]] = step(10); static read(o) { return [o.#p, o.a, o[texts[2]], o.#m(), o[symbols[4]], o.#q, o.g, o[texts[7]], o.#r, o.j, o[symbols[10]]]; } }
function storeNames(o) { o.a = step(0); o.b = step(1); o.c = step(2); o.d = step(3); o.e = step(4); o.f = step(5); o.g = step(6); o.h = step(7); o.i = step(8); o.j = step(9); o.k = step(10); o.l = step(11); o.m = step(12); o.n = step(13); o.o = step(14); o.p = step(15); o.q = step(16); o.r = step(17); o.s = step(18); o.t = step(19); return o; }
function storeKeys(o, keys) { for (var i = 0; i < keys.length; i++) o[keys[i]] = step(i); return o; }
function upTo(n) { var list = []; for (var i = 0; i < n; i++) list.push(i); return list.join(); }
var ways = {
  "fields by name": function (o) { new ByName(o); return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h, o.i, o.j, o.k, o.l, o.m, o.n, o.o, o.p, o.q, o.r, o.s, o.t].join() === upTo(20); },
  "fields by text": function (o) { new ByText(o); return texts.map(function (k) { return o[k]; }).join() === upTo(20); },
  "fields by symbol": function (o) { new BySymbol(o); return symbols.map(function (k) { return o[k]; }).join() === upTo(20); },
  "private fields": function (o) { new Private(o); return Private.read(o).join() === upTo(20); },
  "private methods": function (o) { new PrivateMethods(o); return PrivateMethods.read(o).join() === upTo(9); },
  "of every kind by turns": function (o) { new Mixed(o); return Mixed.read(o).join() === upTo(11); },
  "stores by name": function (o) { storeNames(o); return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h, o.i, o.j, o.k, o.l, o.m, o.n, o.o, o.p, o.q, o.r, o.s, o.t].join() === upTo(20); },
  "stores by text": function (o) { storeKeys(o, texts); return texts.map(function (k) { return o[k]; }).join() === upTo(20); },
  "stores by symbol": function (o) { storeKeys(o, symbols); return symbols.map(function (k) { return o[k]; }).join() === upTo(20); },
  "private fields, then fields by name": function (o) { new Private(o); new ByName(o); return Private.read(o).join() === upTo(20) && o.t === 19; },
  "stores by name, then fields by symbol": function (o) { storeNames(o); new BySymbol(o); return o.a === 0 && o.t === 19 && o[symbols[19]] === 19; },
};
class Heir extends Array {}
class MapHeir extends Map {}
class SetHeir extends Set {}
class PromiseHeir extends Promise {}
function view(make) { return function (round) { var backing = new ArrayBuffer(32); new Uint8Array(backing)[8] = round + 1; var o = make(backing); return [o, function () { return o.buffer === backing && new Uint8Array(o.buffer)[8] === round + 1 && o.byteLength > 0; }]; }; }
function list(make) { return function (round) { var o = make(round), before = Array.prototype.join.call(o), length = o.length; return [o, function () { return Array.prototype.join.call(o) === before && o.length === length && Array.isArray(o); }]; }; }
var kinds = {
  "Uint8Array over a buffer": view(function (b) { return new Uint8Array(b); }),
  "Float64Array over a buffer": view(function (b) { return new Float64Array(b); }),
  "a part of a buffer": view(function (b) { return new Uint8Array(b, 8, 4); }),
  "DataView": view(function (b) { return new DataView(b); }),
  "BigInt64Array over a buffer": view(function (b) { return new BigInt64Array(b); }),
  "a small typed array, its buffer asked for first": function (round) { var o = new Uint8Array(4); o[1] = round + 1; var own = o.buffer; return [o, function () { return o.buffer === own && new Uint8Array(o.buffer)[1] === round + 1; }]; },
  "a small typed array, its buffer asked for last": function (round) { var o = new Uint8Array(4); o[1] = round + 1; return [o, function () { return o[1] === round + 1 && new Uint8Array(o.buffer)[1] === round + 1 && o.buffer === o.buffer; }]; },
  "a large typed array": function (round) { var o = new Uint8Array(100000); o[99999] = round + 1; var own = o.buffer; return [o, function () { return o.buffer === own && o[99999] === round + 1; }]; },
  "an array of integers": list(function (round) { return [1, 2, round]; }),
  "an array of doubles": list(function (round) { return [1.5, 2.5, round + 0.5]; }),
  "an array of values": list(function (round) { return ["a", null, round]; }),
  "an array literal of constants": list(function () { return [1, 2, 3]; }),
  "an empty array": list(function () { return []; }),
  "an array with holes": list(function (round) { var o = [1, 2, 3, round]; delete o[1]; return o; }),
  "a sparse array": list(function (round) { var o = [round]; o[3000] = "far"; return o; }),
  "an array that was pushed to": list(function (round) { var o = []; for (var i = 0; i < 40; i++) o.push(i + round); return o; }),
  "an array that was shifted": list(function (round) { var o = [0, 1, 2, 3, 4, 5, 6, 7, round]; o.shift(); o.shift(); o.unshift(9); return o; }),
  "an heir of Array": list(function (round) { return new Heir(1, 2, round); }),
  "a function": function (round) { var o = function named() { return round; }; return [o, function () { return o() === round && o.name === "named" && o.length === 0 && typeof o.prototype === "object"; }]; },
  "an arrow": function (round) { var o = () => round; return [o, function () { return o() === round && o.name === "o"; }]; },
  "a bound function": function (round) { var o = function (x) { return x; }.bind(null, round); return [o, function () { return o() === round; }]; },
  "a class": function (round) { var o = class Named { static held = round; }; return [o, function () { return o.held === round && o.name === "Named" && new o instanceof o; }]; },
  "a Map": function (round) { var o = new Map([[1, round]]); return [o, function () { return o.get(1) === round && o.size === 1; }]; },
  "an heir of Map": function (round) { var o = new MapHeir([[1, round]]); return [o, function () { return o.get(1) === round && o.size === 1; }]; },
  "an heir of Set": function (round) { var o = new SetHeir([round]); return [o, function () { return o.has(round) && o.size === 1; }]; },
  "an heir of Promise": function (round) { var o = new PromiseHeir(function (resolve) { resolve(round); }); return [o, function () { return o instanceof Promise && typeof o.then === "function"; }]; },
  "a Date": function (round) { var o = new Date(round); return [o, function () { return o.getTime() === round; }]; },
  "a RegExp": function (round) { var o = /a/g; o.lastIndex = round; return [o, function () { return o.lastIndex === round && o.source === "a"; }]; },
  "an Error": function (round) { var o = new Error("message " + round); return [o, function () { return o.message === "message " + round && typeof o.stack === "string"; }]; },
  "an ArrayBuffer": function (round) { var o = new ArrayBuffer(round + 1); return [o, function () { return o.byteLength === round + 1; }]; },
  "a String object": function (round) { var o = new String("ab" + round); return [o, function () { return o.length === 3 && o[2] === String(round); }]; },
  "arguments": function (round) { var o = (function () { return arguments; })(round, 2); return [o, function () { return o[0] === round && o.length === 2; }]; },
  "a plain object": function (round) { var o = { held: round }; return [o, function () { return o.held === round; }]; },
  "an object with elements": function (round) { var o = { held: round }; o[0] = "zero"; o[1] = round; return [o, function () { return o.held === round && o[0] === "zero" && o[1] === round; }]; },
  "an object with no prototype": function (round) { var o = Object.create(null); o.held = round; return [o, function () { return o.held === round; }]; },
  "an object with many properties": function (round) { var o = {}; for (var i = 0; i < 30; i++) o["held" + i] = i + round; return [o, function () { return o.held0 === round && o.held29 === 29 + round; }]; },
};
var elements = {
  "an integer": function (o, n) { o[n] = 7 + n; },
  "behind a hole": function (o, n) { o[7 + n] = n; },
  "a double": function (o, n) { o[3 + n] = 0.5 + n; },
  "an object": function (o, n) { o[3 + n] = { n: n }; },
  "far out": function (o, n) { o[100000 + n] = 1; },
  "five in a row": function (o, n) { for (var k = 0; k < 5; k++) o[n + k] = k; },
  "read-only": function (o, n) { Object.defineProperty(o, 2 + n, { value: n, writable: false, enumerable: true, configurable: true }); },
  "a length of zero": function (o, n) { if (Array.isArray(o)) o.length = 0; else o[n] = "x"; },
  "a push": function (o, n) { if (Array.isArray(o)) o.push(n, n + 1); else o[1] = n; },
};
var places = [];
for (var i = 0; i <= 20; i++) places.push(i);
for (var i = 99999; i <= 100011; i++) places.push(i);
function show(x) { return x !== null && typeof x === "object" ? "{" + x.n + "}" : String(x); }
function look(o) {
  var said = "";
  for (var i = 0; i < places.length; i++) said += places[i] in o ? show(o[places[i]]) + "," : "-";
  return said + ("length" in o ? o.length : "");
}
function careful(f, o, n) { try { f(o, n); return ""; } catch (error) { return error.constructor.name; } }
function sum(text, from) { for (var i = 0; i < text.length; i++) from = (Math.imul(from, 31) + text.charCodeAt(i)) | 0; return from; }
var number = 0;
for (var kind in kinds) {
  if (number++ % parts !== part) continue;
  var sums = [];
  for (var element in elements) {
    for (var isFirst = 0; isFirst < 2; isFirst++) {
      var total = 0;
      for (var way in ways) {
        var row = [], said = [];
        for (var k = 0; k < 6; k++) row.push(kinds[kind](k));
        for (var k = 0; k < 6; k++) {
          current = row[k][0];
          var thrown = isFirst ? careful(elements[element], current, 0) : "";
          between = isFirst ? null : function (o, n) { thrown += careful(elements[element], o, n); };
          var reads;
          try { reads = ways[way](current); } catch (error) { reads = error.constructor.name; }
          between = null;
          said.push(thrown + reads);
        }
        for (var k = 0; k < 6; k++) total = sum(said[k] + look(row[k][0]) + row[k][1](), total);
      }
      sums.push(total);
    }
  }
  console.log(kind + ": " + sums.join(" "));
}
/* Output:
Uint8Array over a buffer: 553061577 -1243157535 654991319 872949505 279595351 872949505 872949505 872949505 872949505 872949505 394762135 -1289539519 922317919 -896966453 872949505 872949505 938905449 872949505
Float64Array over a buffer: -635962925 -1528873519 -1530545441 -1530545441 -1530545441 683582701 -1530545441 -1926148427 -1530545441 -1530545441 -1530545441 -126268978 -166953391 1289639301 -424616271 148067977 1779157885 -1287332390
a part of a buffer: -1776317053 -1149906612 -1005924351 -1005924351 -1005924351 -1005924351 -1005924351 -1005924351 -1005924351 -1005924351 -1005924351 -126268978 -1886768777 -364869677 -1005924351 -1287332390 1158200181 -1005924351
DataView: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
BigInt64Array over a buffer: -1830874569 1234904467 -1830874569 1234904467 -1830874569 1234904467 1164646957 -1682550619 -1830874569 1234904467 -1830874569 1234904467 -1830874569 1234904467 1164646957 -1682550619 -1830874569 1234904467
a small typed array, its buffer asked for first: -2121874493 1348937057 88210497 88210497 88210497 88210497 88210497 88210497 88210497 88210497 88210497 224410221 -1830874569 1234904467 88210497 88210497 926305571 -1287332390
a small typed array, its buffer asked for last: -2121874493 1348937057 88210497 88210497 88210497 88210497 88210497 88210497 88210497 88210497 88210497 224410221 -1830874569 1234904467 88210497 88210497 926305571 -1287332390
a large typed array: -335768005 -164775055 242041055 -399201729 2119243999 -399201729 -399201729 -399201729 -399201729 -399201729 1502521489 539679403 -182858241 -1970790145 -399201729 -399201729 -1397837633 -399201729
an array of integers: -1229559311 173292193 -1377153371 903537159 99966995 655541505 -676747887 -1204226017 1496594123 -1065234111 -265641579 -1482223776 -1658468449 -1716005845 -1246292225 -1621989630 -1126225003 1326476801
an array of doubles: -391658233 -1337245023 -2039378935 -486434723 1901705847 -71467689 -478476491 -1465949899 -393755905 -499682143 -1444988279 -1482223776 -1645504893 1328939136 2128629441 -1621989630 -1229163639 -791041183
an array of values: -655040385 -640516701 -162256367 -1679231073 -723228715 -487751873 -1185227951 2123146911 1430777695 -1537309231 -2035623147 -1482223776 572650383 -2006865563 1114308889 -1621989630 -1511595815 -1189415971
an array literal of constants: -2030420944 -24679136 -2115150748 1981789382 -1345141166 1240896576 -2121856048 -618870946 -156228150 334157120 1507003924 -1482223776 1898501470 -319657920 -787367268 -1621989630 -1898839532 623694080
an empty array: 677767168 782389632 -237958378 -1881599552 995243802 -1255348832 1216424918 -280898112 1616311940 697024574 1060652218 -1482223776 1855117076 870517472 -1303618048 -1303618048 1670714006 213914412
an array with holes: 408064972 -480302337 -2080568403 -210510053 -1249843237 2010146336 -2026558119 -1337479680 -473710045 -836792769 -749440382 -1482223776 1933083815 1932768607 -1675493055 -1621989630 1249046061 -1406124513
a sparse array: -1834272099 1725660534 -835865859 1233639617 -1498539309 -1993310879 -1348159279 -1776277055 -1317488739 -841075039 -509505237 -1843456688 -1324327111 1500336065 -537019041 -1621989630 -539329131 -846766533
an array that was pushed to: 218039658 1239169222 752126454 743773161 -95419996 -329454106 1414687896 1734071750 1717334295 -988635481 -588735097 1758224145 598615565 1314779686 858918771 -1621989630 -501630461 975518465
an array that was shifted: 211817501 -804396695 1704471517 329013477 -1694754943 -1754236577 1834769313 843308541 1944399643 1069175537 -1568652125 629598335 -1507217087 -1019442581 -107067329 -1621989630 64731265 390395393
an heir of Array: -1229559311 173292193 -1377153371 903537159 99966995 655541505 -676747887 -1204226017 1496594123 -1065234111 -265641579 -1482223776 -1658468449 -1716005845 -1246292225 -1621989630 -1126225003 1326476801
a function: -742579456 -956474456 521441666 1851331142 -1378318738 -1395129580 261601258 -374311754 -2129748192 268615220 478384148 -1922663806 630879890 852543670 -1775160286 1073852966 186177024 -802849722
an arrow: -742579456 -956474456 521441666 1851331142 -1378318738 -1395129580 261601258 -374311754 -2129748192 268615220 478384148 -1922663806 630879890 852543670 -1775160286 1073852966 186177024 -802849722
a bound function: -742579456 -956474456 521441666 1851331142 -1378318738 -1395129580 261601258 -374311754 -2129748192 268615220 478384148 -1922663806 630879890 852543670 -1775160286 1073852966 186177024 -802849722
a class: -742579456 -956474456 521441666 1851331142 -1378318738 -1395129580 261601258 -374311754 -2129748192 268615220 478384148 -1922663806 630879890 852543670 -1775160286 1073852966 186177024 -802849722
a Map: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an heir of Map: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an heir of Set: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an heir of Promise: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
a Date: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
a RegExp: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an Error: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an ArrayBuffer: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
a String object: -629531719 1403316639 1427732963 -1494136223 1129828665 1426749185 -569526665 1318761249 -2105022647 -869764735 -669847359 1403316639 -2119468641 1403316639 1981753985 1403316639 -2029656421 1403316639
arguments: 172732961 77187228 59604145 -1828922575 249313565 -163873025 -1885977383 715073633 554587615 2005812575 1423110675 -372930293 -583737535 247833505 770865569 869069786 1812652281 2044104865
a plain object: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an object with elements: 1520517759 -1493663455 1352138159 -1689534609 259800963 1942826657 1727740423 1619104063 34468545 1939169601 91859597 -1894364020 41696159 731993855 -1982228481 2022935233 1187175517 923832021
an object with no prototype: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
an object with many properties: 1330363744 1565519104 421399278 -1282573216 -2015820200 -1579107520 2064978138 1827863456 385796936 1095894208 799645648 1488892064 1863186610 -1733038240 1711627152 -1776463264 1118339192 -1837589408
*/
