// Every handler x every target x every receiver x every access x every key, each three times at warm sites: what is answered, what is thrown and what the traps saw, as one sum for each handler and target. With the argument "all" every line is printed.
var mark = Symbol("mark");
var keys = ["wanted", "other", mark, Symbol.iterator, 0, "0", 7, "-1", "1.5", "__proto__", "length", "constructor", "", "get", "has", "set"];
var log = [];
function show(v) {
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return "function";
  if (typeof v === "bigint") return v + "n";
  if (v === null) return "null";
  if (typeof v === "object") return Array.isArray(v) ? "array" : "object";
  if (Object.is(v, -0)) return "-0";
  return typeof v === "string" ? (v.length > 24 ? "a long text" : JSON.stringify(v)) : String(v);
}
var accesses = {
  getWanted: function (o) { return o.wanted; },
  getOther: function (o) { return o.other; },
  getLength: function (o) { return o.length; },
  getKey: function (o, k) { return o[k]; },
  callWanted: function (o) { return typeof o.wanted === "function" ? "f" : o.wanted; },
  method: function (o) { return o.wanted(); },
  hasWanted: function (o) { return "wanted" in o; },
  hasOther: function (o) { return "other" in o; },
  hasKey: function (o, k) { return k in o; },
  setWantedSloppy: function (o, k, v) { o.wanted = v; return "stored"; },
  setOtherSloppy: function (o, k, v) { o.other = v; return "stored"; },
  setKeySloppy: function (o, k, v) { o[k] = v; return "stored"; },
  setWantedStrict: function (o, k, v) { "use strict"; o.wanted = v; return "stored"; },
  setOtherStrict: function (o, k, v) { "use strict"; o.other = v; return "stored"; },
  setKeyStrict: function (o, k, v) { "use strict"; o[k] = v; return "stored"; },
  addTo: function (o) { o.wanted += 1; return o.wanted; },
  destructure: function (o) { var { wanted, other } = o; return show(wanted) + show(other); },
  optional: function (o) { return o?.wanted?.length; },
};
var usesKey = { getKey: 1, hasKey: 1, setKeySloppy: 1, setKeyStrict: 1 };
function note() { log.push(Array.prototype.map.call(arguments, show).join(",")); }
var answers = [true, false, 0, 1, "", "x", null, undefined, NaN, {}, 0n, 1n, -0, mark];
var handlers = {
  forwards: function () { return { get(t, k, r) { note("get", k, r === this.r); return t[k]; }, has(t, k) { note("has", k); return k in t; }, set(t, k, v, r) { note("set", k, v); t[k] = v; return true; } }; },
  reflects: function () { return { get: Reflect.get, has: Reflect.has, set: Reflect.set }; },
  empty: function () { return {}; },
  nullProto: function () { var h = Object.create(null); h.get = function (t, k) { note("get", k); return 1; }; h.has = function () { return true; }; h.set = function () { return true; }; return h; },
  throws: function () { return { get() { throw new RangeError("get"); }, has() { throw new RangeError("has"); }, set() { throw new RangeError("set"); } }; },
  throwsOdd: function () { return { get() { throw 1; }, has() { throw null; }, set() { throw undefined; } }; },
  notCallable: function () { return { get: 1, has: "x", set: {} }; },
  nulls: function () { return { get: null, has: undefined, set: null }; },
  getters: function () { var n = 0; return { get get() { note("read get", ++n); return function (t, k) { return n; }; }, get has() { note("read has", ++n); return function () { return n & 1; }; }, get set() { note("read set", ++n); return function () { return n & 1; }; } }; },
  gettersThrow: function () { return { get get() { throw new SyntaxError("g"); }, get has() { throw new SyntaxError("h"); }, get set() { throw new SyntaxError("s"); } }; },
  gettersUndefined: function () { return { get get() { note("read get"); }, get has() { note("read has"); }, get set() { note("read set"); } }; },
  ofClass: function () { class H { get(t, k) { note("class get", k); return 2; } has(t, k) { note("class has", k); return false; } set(t, k, v) { note("class set", k, v); return true; } } return new H; },
  inherited: function () { return Object.create(Object.create({ get(t, k) { return "far"; }, has() { return true; }, set() { return false; } })); },
  frozen: function () { return Object.freeze({ get(t, k) { return "frozen"; }, has() { return false; }, set() { return true; } }); },
  proxied: function () { return new Proxy({ get(t, k) { return "inner"; } }, { get(t, k) { note("handler asked", k); return t[k]; } }); },
  bound: function () { return { get: function (a, t, k) { return a; }.bind(null, "bound"), has: function (a) { return a; }.bind(null, true), set: function (a) { return a; }.bind(null, false) }; },
  arrows: function () { return { get: (t, k) => typeof k, has: (t, k) => typeof k === "string", set: (t, k, v) => v !== 2 }; },
  callableProxies: function () { return { get: new Proxy(function (t, k) { return "cp"; }, {}), has: new Proxy(function () { return true; }, {}), set: new Proxy(function () { return true; }, {}) }; },
  asyncs: function () { return { get: async function () { return 1; }, has: async function () { return false; }, set: function* () { return false; } }; },
  classes: function () { return { get: class {}, has: class {}, set: class {} }; },
  freezesTarget: function () { return { get(t, k) { Object.freeze(t); return 5; }, has(t, k) { Object.freeze(t); return false; }, set(t, k, v) { Object.freeze(t); return true; } }; },
  definesOnTarget: function () { return { get(t, k) { try { Object.defineProperty(t, k, { value: 1, configurable: false, writable: false }); } catch (e) {} return 5; }, has(t, k) { try { Object.defineProperty(t, k, { value: 1, configurable: false }); } catch (e) {} return false; }, set(t, k, v) { try { Object.defineProperty(t, k, { value: 1, configurable: false, writable: false }); } catch (e) {} return true; } }; },
  usesArguments: function () { return { get() { return arguments.length + ":" + (this === arguments[2]); }, has() { return arguments.length === 2; }, set() { note("args", arguments.length); return arguments.length === 4; } }; },
};
answers.forEach(function (a, i) { handlers["answers" + i] = function () { return { get() { return a; }, has() { return a; }, set() { return a; } }; }; });
var targets = {
  empty: function () { return {}; },
  has: function () { return { wanted: 1, other: "o" }; },
  method: function () { return { wanted() { return this === undefined ? "u" : typeof this; } }; },
  frozen: function () { return Object.freeze({ wanted: 1, [mark]: 2, 0: 3 }); },
  sealed: function () { return Object.seal({ wanted: 1 }); },
  closed: function () { return Object.preventExtensions({ wanted: 1 }); },
  fixedValue: function () { return Object.defineProperty({}, "wanted", { value: 1 }); },
  fixedWritable: function () { return Object.defineProperty({}, "wanted", { value: 1, writable: true }); },
  getterOnly: function () { return Object.defineProperty({}, "wanted", { get() { return 1; } }); },
  setterOnly: function () { return Object.defineProperty({}, "wanted", { set(v) {} }); },
  looseAccessor: function () { return { get wanted() { return this; }, set wanted(v) { note("setter", v, typeof this); } }; },
  grown: function () { var t = { a: 1 }; t.wanted = 1; t.z = 2; t[mark] = 3; return t; },
  shrunk: function () { var t = { wanted: 1, other: 2 }; delete t.wanted; return t; },
  array: function () { return [1, 2]; },
  frozenArray: function () { return Object.freeze([1, 2]); },
  fn: function () { return function wanted(a, b) {}; },
  bare: function () { return Object.create(null); },
  instance: function () { class T { constructor() { this.wanted = 1; } get other() { return "getter"; } } return new T; },
  proxy: function () { return new Proxy({ wanted: 1 }, { get(t, k) { note("inner get", k); return t[k]; }, has(t, k) { note("inner has", k); return k in t; }, set(t, k, v) { note("inner set", k); t[k] = v; return true; } }); },
  bareProxy: function () { return new Proxy({ wanted: 1 }, {}); },
  map: function () { return new Map; },
  text: function () { return new String("ab"); },
};
var receivers = {
  itself: function (p) { return p; },
  below: function (p) { return Object.create(p); },
  belowWithOwn: function (p) { var o = Object.create(p); Object.defineProperty(o, "other", { value: "own", writable: true, configurable: true, enumerable: true }); return o; },
  around: function (p) { return new Proxy(p, {}); },
  aroundTrapped: function (p) { return new Proxy(p, { get(t, k, r) { note("outer get", k); return Reflect.get(t, k, r); }, has(t, k) { note("outer has", k); return Reflect.has(t, k); }, set(t, k, v, r) { note("outer set", k); return Reflect.set(t, k, v, r); } }); },
};
function run(name, o, k, v) {
  var text;
  try { text = show(accesses[name](o, k, v)); } catch (e) { text = "threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : show(e)); }
  return text;
}
// The sites are warm before anything is printed.
var warm = new Proxy({ wanted: function () { return 1; } }, handlers.forwards());
for (var i = 0; i < 200; i++) for (var name in accesses) run(name, warm, keys[i % 4], i);
log.length = 0;
var lines = 0, sum = 0;
function tell(text) { lines++; for (var i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; if (process.argv[2] === "all") console.log(text); }
var section = [];
for (var h in handlers) for (var t in targets) {
  sum = 0;
  for (var r in receivers) for (var name in accesses) {
    var list = usesKey[name] ? keys : [undefined];
    for (var k of list) {
      var handler = handlers[h](), proxy = new Proxy(targets[t](), handler), o = receivers[r](proxy);
      try { handler.r = o; } catch (e) {}
      var got = [run(name, o, k, 2), run(name, o, k, 1), run(name, o, k, 2)];
      tell([h, t, r, name, show(k)].join(" ") + ": " + got.join(" | ") + " ; " + log.join(" ")); log.length = 0;
    }
  }
  section.push(h + "/" + t + " " + sum);
}
console.log(section.join("\n"));
console.log(lines);
/* Output:
forwards/empty -21487192
forwards/has -687605611
forwards/method -143327425
forwards/frozen -1026464096
forwards/sealed 67112059
forwards/closed -237657573
forwards/fixedValue 1984450453
forwards/fixedWritable 1567427443
forwards/getterOnly -1099819328
forwards/setterOnly -2005561653
forwards/looseAccessor 589085115
forwards/grown 1316110681
forwards/shrunk 59164748
forwards/array -2053639730
forwards/frozenArray -867979987
forwards/fn 586940638
forwards/bare 1580207913
forwards/instance 1812025821
forwards/proxy -1453723775
forwards/bareProxy 171279027
forwards/map 653970896
forwards/text 287401808
reflects/empty -2141357435
reflects/has 499652920
reflects/method -334229266
reflects/frozen 733758629
reflects/sealed 486498534
reflects/closed 703201446
reflects/fixedValue 1511299608
reflects/fixedWritable -952357344
reflects/getterOnly -891250156
reflects/setterOnly -1250238150
reflects/looseAccessor 1516901569
reflects/grown 1166894596
reflects/shrunk 827166607
reflects/array -595676961
reflects/frozenArray 1714303364
reflects/fn 1001995199
reflects/bare 52588910
reflects/instance -1636058150
reflects/proxy 1201062018
reflects/bareProxy 914548320
reflects/map -1114863769
reflects/text 1597256449
empty/empty -1847241671
empty/has -435547544
empty/method 177572142
empty/frozen -57294271
empty/sealed -1425183794
empty/closed -436162194
empty/fixedValue 1314484052
empty/fixedWritable 1233826428
empty/getterOnly 1815600900
empty/setterOnly 283705844
empty/looseAccessor -237088257
empty/grown 1597003490
empty/shrunk 600199465
empty/array 1682653317
empty/frozenArray 1780859730
empty/fn 1062857645
empty/bare -753937432
empty/instance -1758545382
empty/proxy -1619925590
empty/bareProxy -229458004
empty/map -1413239517
empty/text -1713810815
nullProto/empty 140833001
nullProto/has -2118855263
nullProto/method 200773863
nullProto/frozen -850502368
nullProto/sealed -679881415
nullProto/closed -816236903
nullProto/fixedValue 1095704708
nullProto/fixedWritable -673709807
nullProto/getterOnly -1551758741
nullProto/setterOnly 871982183
nullProto/looseAccessor -1305660631
nullProto/grown -549118919
nullProto/shrunk 176394847
nullProto/array 376644617
nullProto/frozenArray -806594159
nullProto/fn 1342645889
nullProto/bare 1433290525
nullProto/instance 37971487
nullProto/proxy 471251841
nullProto/bareProxy -893377071
nullProto/map -2081595567
nullProto/text 349480267
throws/empty 1241284373
throws/has 2026591279
throws/method -1186536363
throws/frozen -925744547
throws/sealed 967904381
throws/closed 2098576381
throws/fixedValue -1164046987
throws/fixedWritable 1318763043
throws/getterOnly 36401829
throws/setterOnly 192766213
throws/looseAccessor 611686021
throws/grown 2066823793
throws/shrunk 1740366517
throws/array 1929092653
throws/frozenArray -923531475
throws/fn -1346790755
throws/bare 1152292877
throws/instance -2105592011
throws/proxy 1909667607
throws/bareProxy -995519501
throws/map -697625677
throws/text -1838892171
throwsOdd/empty -1520655101
throwsOdd/has 732255709
throwsOdd/method 571217253
throwsOdd/frozen -2020953103
throwsOdd/sealed -1976923871
throwsOdd/closed 742619233
throwsOdd/fixedValue -156370667
throwsOdd/fixedWritable -339081967
throwsOdd/getterOnly 462017885
throwsOdd/setterOnly -850025491
throwsOdd/looseAccessor -1772530829
throwsOdd/grown 796991583
throwsOdd/shrunk 1527678197
throwsOdd/array -1496234981
throwsOdd/frozenArray -903723941
throwsOdd/fn -1220486127
throwsOdd/bare 1871439257
throwsOdd/instance -1691307851
throwsOdd/proxy 945716485
throwsOdd/bareProxy 1899988065
throwsOdd/map -1025065887
throwsOdd/text 2114244629
notCallable/empty -2029344299
notCallable/has 1649837
notCallable/method -1443017107
notCallable/frozen -1861661973
notCallable/sealed -162928541
notCallable/closed -865371005
notCallable/fixedValue 1143334501
notCallable/fixedWritable 1127203997
notCallable/getterOnly 931147097
notCallable/setterOnly 1683890753
notCallable/looseAccessor 1437285909
notCallable/grown 2020036709
notCallable/shrunk 1800994517
notCallable/array -1958578827
notCallable/frozenArray -53279243
notCallable/fn -1968527941
notCallable/bare -1289903921
notCallable/instance -737119147
notCallable/proxy 750194637
notCallable/bareProxy -152272163
notCallable/map -1896021987
notCallable/text -886004091
nulls/empty -2019017117
nulls/has -1165350382
nulls/method -1540891780
nulls/frozen -1481334279
nulls/sealed -2089600216
nulls/closed -1100578616
nulls/fixedValue 1048710412
nulls/fixedWritable 356492910
nulls/getterOnly 1549827260
nulls/setterOnly 1212342892
nulls/looseAccessor -909513889
nulls/grown -189345272
nulls/shrunk 240153685
nulls/array 2079528427
nulls/frozenArray -722317810
nulls/fn 728746109
nulls/bare 1470174612
nulls/instance 881289294
nulls/proxy -1938982046
nulls/bareProxy 118044446
nulls/map 774612117
nulls/text 239016375
getters/empty 1884957559
getters/has 1029543197
getters/method 2067082199
getters/frozen -1132216867
getters/sealed -210577385
getters/closed 43519287
getters/fixedValue 1927307320
getters/fixedWritable 251700169
getters/getterOnly 853961635
getters/setterOnly 1533531809
getters/looseAccessor -555458553
getters/grown 1595150235
getters/shrunk 756613207
getters/array 824231602
getters/frozenArray -1292141290
getters/fn -1021216585
getters/bare -21686601
getters/instance 1925167447
getters/proxy 88238517
getters/bareProxy 1585556825
getters/map -1805079527
getters/text 1127246878
gettersThrow/empty 2144513149
gettersThrow/has 207538643
gettersThrow/method -778059075
gettersThrow/frozen 147478557
gettersThrow/sealed -1610496611
gettersThrow/closed 981544861
gettersThrow/fixedValue -668056771
gettersThrow/fixedWritable 978807487
gettersThrow/getterOnly 1052996221
gettersThrow/setterOnly 1611940093
gettersThrow/looseAccessor 1919613837
gettersThrow/grown 579154369
gettersThrow/shrunk 1626442557
gettersThrow/array -143304795
gettersThrow/frozenArray 1829888421
gettersThrow/fn 970766749
gettersThrow/bare -1038305251
gettersThrow/instance 675783357
gettersThrow/proxy -1514791765
gettersThrow/bareProxy 2058739823
gettersThrow/map -1631911761
gettersThrow/text 403800253
gettersUndefined/empty 1861222413
gettersUndefined/has -307466254
gettersUndefined/method -1031178760
gettersUndefined/frozen 1926342605
gettersUndefined/sealed -1012362148
gettersUndefined/closed 777689532
gettersUndefined/fixedValue 988614208
gettersUndefined/fixedWritable -1289149438
gettersUndefined/getterOnly 12598920
gettersUndefined/setterOnly 90912126
gettersUndefined/looseAccessor -563674415
gettersUndefined/grown -2054582966
gettersUndefined/shrunk 1648071403
gettersUndefined/array 138875697
gettersUndefined/frozenArray -1983139716
gettersUndefined/fn -1249955435
gettersUndefined/bare 122765628
gettersUndefined/instance -1490985610
gettersUndefined/proxy 230981596
gettersUndefined/bareProxy 1379135186
gettersUndefined/map -33009785
gettersUndefined/text -836860427
ofClass/empty -552747912
ofClass/has 116300780
ofClass/method -252538164
ofClass/frozen -1679106156
ofClass/sealed 1451935890
ofClass/closed 1845240658
ofClass/fixedValue 2056665931
ofClass/fixedWritable 379454644
ofClass/getterOnly -746199955
ofClass/setterOnly 1844200944
ofClass/looseAccessor -2033032872
ofClass/grown 858629424
ofClass/shrunk -1814819980
ofClass/array -1235569201
ofClass/frozenArray 1634477535
ofClass/fn -898718902
ofClass/bare -1191950082
ofClass/instance -1250728204
ofClass/proxy -2131518596
ofClass/bareProxy 211580852
ofClass/map 2066814580
ofClass/text 358013543
inherited/empty 1251017231
inherited/has 26161569
inherited/method -1098211557
inherited/frozen -281284993
inherited/sealed -1254399265
inherited/closed -14394465
inherited/fixedValue 1519277615
inherited/fixedWritable 1974268293
inherited/getterOnly -223135325
inherited/setterOnly 535337232
inherited/looseAccessor 982209215
inherited/grown -2056358597
inherited/shrunk -1181015669
inherited/array -895671993
inherited/frozenArray -1508408577
inherited/fn -2054451345
inherited/bare -65433817
inherited/instance -1750085493
inherited/proxy -546379671
inherited/bareProxy 722357525
inherited/map 1008069845
inherited/text 1349641171
frozen/empty 1557479321
frozen/has 1931462627
frozen/method 1993574373
frozen/frozen 1273461468
frozen/sealed -1679323163
frozen/closed 1459792889
frozen/fixedValue 510112604
frozen/fixedWritable -386215117
frozen/getterOnly 1911832981
frozen/setterOnly 100982825
frozen/looseAccessor 949080457
frozen/grown -2026857451
frozen/shrunk -2011791787
frozen/array 799583174
frozen/frozenArray 1811106652
frozen/fn -1961561287
frozen/bare -1361590543
frozen/instance 1038888277
frozen/proxy -471324277
frozen/bareProxy 1239769479
frozen/map 595057223
frozen/text 720373834
proxied/empty 1496725742
proxied/has 511759608
proxied/method 1944137640
proxied/frozen -1091512328
proxied/sealed -149642120
proxied/closed -185856328
proxied/fixedValue 1737566938
proxied/fixedWritable 1091353674
proxied/getterOnly 1494992184
proxied/setterOnly 1565604713
proxied/looseAccessor -1429225989
proxied/grown 868603941
proxied/shrunk -735983450
proxied/array 1701882932
proxied/frozenArray 1824343096
proxied/fn 613430763
proxied/bare 84078276
proxied/instance -896558822
proxied/proxy -1797075939
proxied/bareProxy 909993706
proxied/map 1601066220
proxied/text 1833690610
bound/empty 800660524
bound/has 250288574
bound/method 1813878390
bound/frozen 282568463
bound/sealed -64115462
bound/closed 1998645690
bound/fixedValue -1082335798
bound/fixedWritable 1347255906
bound/getterOnly 940042238
bound/setterOnly -13328345
bound/looseAccessor -849666084
bound/grown 996938456
bound/shrunk -1757194778
bound/array -1720906140
bound/frozenArray -1448583312
bound/fn -1269148918
bound/bare 1196262914
bound/instance -1720744538
bound/proxy 1649530566
bound/bareProxy -571313806
bound/map -245277326
bound/text -1209923350
arrows/empty 1111712430
arrows/has -1301152632
arrows/method -1597221150
arrows/frozen 733731907
arrows/sealed 1483034314
arrows/closed 483963466
arrows/fixedValue -705268005
arrows/fixedWritable -1738436868
arrows/getterOnly -1785652009
arrows/setterOnly 1548838760
arrows/looseAccessor -854615010
arrows/grown 1080090762
arrows/shrunk 527007298
arrows/array -1621677370
arrows/frozenArray 619241728
arrows/fn 2073643498
arrows/bare -995457318
arrows/instance -1625336638
arrows/proxy 598727536
arrows/bareProxy -510590772
arrows/map -1906391156
arrows/text -1797400812
callableProxies/empty 567120494
callableProxies/has 1614975128
callableProxies/method -1591913326
callableProxies/frozen 1865268495
callableProxies/sealed 240948298
callableProxies/closed 1088372426
callableProxies/fixedValue 1065121511
callableProxies/fixedWritable 2134448812
callableProxies/getterOnly -159017201
callableProxies/setterOnly -1791935154
callableProxies/looseAccessor 1672533854
callableProxies/grown 322267690
callableProxies/shrunk 1295280818
callableProxies/array -1518622394
callableProxies/frozenArray -1025002980
callableProxies/fn 289725610
callableProxies/bare -2016134918
callableProxies/instance -922225102
callableProxies/proxy 1439897536
callableProxies/bareProxy -296486660
callableProxies/map -592380740
callableProxies/text -23838732
asyncs/empty 1799485959
asyncs/has -26413425
asyncs/method -42598337
asyncs/frozen 28890225
asyncs/sealed -1386580891
asyncs/closed 393552261
asyncs/fixedValue 1903428381
asyncs/fixedWritable -2069317921
asyncs/getterOnly 146412450
asyncs/setterOnly 736619256
asyncs/looseAccessor 1130823367
asyncs/grown -161885513
asyncs/shrunk 1262483943
asyncs/array 475164391
asyncs/frozenArray -114186747
asyncs/fn 1320100989
asyncs/bare 640447025
asyncs/instance -1377141401
asyncs/proxy -1438253713
asyncs/bareProxy 1213037727
asyncs/map 1866752735
asyncs/text -2084669879
classes/empty 1079785801
classes/has 1427184041
classes/method -1656790481
classes/frozen -674628927
classes/sealed 719754633
classes/closed -1701654423
classes/fixedValue 47323383
classes/fixedWritable 1657066857
classes/getterOnly -1451934621
classes/setterOnly -998742981
classes/looseAccessor 2096742217
classes/grown -796276343
classes/shrunk 1235262087
classes/array 1431618505
classes/frozenArray -2129511287
classes/fn -2052690703
classes/bare -36942979
classes/instance 1507147335
classes/proxy 203410985
classes/bareProxy 1223622505
classes/map 40742377
classes/text -1760436201
freezesTarget/empty -1016355668
freezesTarget/has -222149627
freezesTarget/method -1283333501
freezesTarget/frozen 662912362
freezesTarget/sealed -735801083
freezesTarget/closed 28296037
freezesTarget/fixedValue -886944149
freezesTarget/fixedWritable -207330941
freezesTarget/getterOnly 129186155
freezesTarget/setterOnly 1998921126
freezesTarget/looseAccessor 1492418524
freezesTarget/grown -1980059004
freezesTarget/shrunk -365162694
freezesTarget/array -812446577
freezesTarget/frozenArray -270714545
freezesTarget/fn 315652673
freezesTarget/bare -419691980
freezesTarget/instance -1645755077
freezesTarget/proxy 162269499
freezesTarget/bareProxy 1467320035
freezesTarget/map 277841310
freezesTarget/text -1828161651
definesOnTarget/empty 1289056553
definesOnTarget/has 668899589
definesOnTarget/method -1158620527
definesOnTarget/frozen -1208437208
definesOnTarget/sealed -1672740093
definesOnTarget/closed -1982967453
definesOnTarget/fixedValue -1436096519
definesOnTarget/fixedWritable 1821694589
definesOnTarget/getterOnly 1913900369
definesOnTarget/setterOnly 718211654
definesOnTarget/looseAccessor -2026829367
definesOnTarget/grown 1451811153
definesOnTarget/shrunk 417136457
definesOnTarget/array -870177863
definesOnTarget/frozenArray 1781373481
definesOnTarget/fn 1504353051
definesOnTarget/bare 549420823
definesOnTarget/instance 1675513673
definesOnTarget/proxy -1299993803
definesOnTarget/bareProxy -445320995
definesOnTarget/map 1199604893
definesOnTarget/text 738928857
usesArguments/empty -2006703539
usesArguments/has -1255679255
usesArguments/method 757245603
usesArguments/frozen -770397057
usesArguments/sealed 1842264545
usesArguments/closed 1191793537
usesArguments/fixedValue 1200555414
usesArguments/fixedWritable 350738593
usesArguments/getterOnly 1831915293
usesArguments/setterOnly -701950205
usesArguments/looseAccessor 451246573
usesArguments/grown 452598389
usesArguments/shrunk -724845333
usesArguments/array -495508259
usesArguments/frozenArray 1933617961
usesArguments/fn -1899418151
usesArguments/bare -351579747
usesArguments/instance 1344276779
usesArguments/proxy 1088862297
usesArguments/bareProxy -1143487871
usesArguments/map 1763394433
usesArguments/text 1584994943
answers0/empty 1979928453
answers0/has 1701390349
answers0/method 1580905889
answers0/frozen 969665995
answers0/sealed -696178617
answers0/closed 1909067111
answers0/fixedValue -1868372446
answers0/fixedWritable -1734051235
answers0/getterOnly -1420096545
answers0/setterOnly -1148811375
answers0/looseAccessor -2066457531
answers0/grown -1808722891
answers0/shrunk -226679479
answers0/array 2072411237
answers0/frozenArray 755606863
answers0/fn 728654431
answers0/bare 1801874195
answers0/instance 369869001
answers0/proxy 215698669
answers0/bareProxy -2027600867
answers0/map -981292963
answers0/text 1109036207
answers1/empty 1762481604
answers1/has -532667454
answers1/method -281926358
answers1/frozen -1835138050
answers1/sealed 1195430854
answers1/closed -2007379354
answers1/fixedValue 293683255
answers1/fixedWritable 728542110
answers1/getterOnly -95263806
answers1/setterOnly -2008520374
answers1/looseAccessor -879976044
answers1/grown -808659592
answers1/shrunk 1915756986
answers1/array -423666847
answers1/frozenArray -247328247
answers1/fn 513207958
answers1/bare 2144466718
answers1/instance 1146759290
answers1/proxy 1791001466
answers1/bareProxy -181405650
answers1/map -626805074
answers1/text -399709395
answers2/empty -1426546815
answers2/has -173646465
answers2/method -1673985733
answers2/frozen -703637638
answers2/sealed 350558935
answers2/closed 867448567
answers2/fixedValue 1355865484
answers2/fixedWritable -285390885
answers2/getterOnly -764508333
answers2/setterOnly 2080771617
answers2/looseAccessor 1909700945
answers2/grown -920587723
answers2/shrunk -441800757
answers2/array 1766980446
answers2/frozenArray 1155789490
answers2/fn 911271719
answers2/bare 342785583
answers2/instance 1231241227
answers2/proxy -667746377
answers2/bareProxy 1937524843
answers2/map -182282901
answers2/text 242964002
answers3/empty 179652136
answers3/has -492283710
answers3/method 293967584
answers3/frozen 1163823312
answers3/sealed 1678753596
answers3/closed 98774140
answers3/fixedValue -428201802
answers3/fixedWritable 389754550
answers3/getterOnly 1428194639
answers3/setterOnly -2093904668
answers3/looseAccessor 1405023128
answers3/grown -1664242556
answers3/shrunk -2017513488
answers3/array -1007881408
answers3/frozenArray 598435408
answers3/fn -1481003988
answers3/bare -237003596
answers3/instance -1018365968
answers3/proxy -1210080086
answers3/bareProxy -1455209338
answers3/map -258863034
answers3/text 1747858776
answers4/empty -501634891
answers4/has 486489985
answers4/method -1487821577
answers4/frozen 2110713980
answers4/sealed 1406656345
answers4/closed -1722181939
answers4/fixedValue 1375220056
answers4/fixedWritable -1208597483
answers4/getterOnly 1919917823
answers4/setterOnly -890294949
answers4/looseAccessor -1572316971
answers4/grown -783684611
answers4/shrunk -115904865
answers4/array -1157857766
answers4/frozenArray 665243388
answers4/fn 1650219701
answers4/bare -1060383063
answers4/instance -1587861793
answers4/proxy 391095217
answers4/bareProxy -1550697223
answers4/map 2080798713
answers4/text 605622160
answers5/empty -750420078
answers5/has 905088620
answers5/method 130224440
answers5/frozen 995511323
answers5/sealed -950997100
answers5/closed -1068729132
answers5/fixedValue -1950135590
answers5/fixedWritable 1298688928
answers5/getterOnly 2102608094
answers5/setterOnly -1885335639
answers5/looseAccessor 1353854466
answers5/grown 1722237678
answers5/shrunk 422449736
answers5/array -33296726
answers5/frozenArray 86645174
answers5/fn -1406973180
answers5/bare -1279251380
answers5/instance 1446954760
answers5/proxy -1995615340
answers5/bareProxy -1236166928
answers5/map 1642729712
answers5/text 1199283564
answers6/empty 1097346724
answers6/has 813142064
answers6/method 743317572
answers6/frozen -2116383098
answers6/sealed -480609114
answers6/closed 1679569562
answers6/fixedValue -1994629991
answers6/fixedWritable 341818500
answers6/getterOnly 1474884940
answers6/setterOnly 1260228012
answers6/looseAccessor 284419012
answers6/grown 140720620
answers6/shrunk 2048007148
answers6/array -1236268791
answers6/frozenArray -351318929
answers6/fn -750491134
answers6/bare -1578661962
answers6/instance -1875286804
answers6/proxy 2017158560
answers6/bareProxy -89573016
answers6/map 674619560
answers6/text 1674778905
answers7/empty 42616495
answers7/has 1317371501
answers7/method 945855447
answers7/frozen -180785228
answers7/sealed -773595533
answers7/closed -154025325
answers7/fixedValue 562128230
answers7/fixedWritable -1748303735
answers7/getterOnly 93410671
answers7/setterOnly -1347736833
answers7/looseAccessor -174817921
answers7/grown -330140829
answers7/shrunk -1294995865
answers7/array 2005468556
answers7/frozenArray -43099936
answers7/fn 980133187
answers7/bare -1770292981
answers7/instance 2098830695
answers7/proxy 887849445
answers7/bareProxy 554196761
answers7/map -405083047
answers7/text -2053881922
answers8/empty -689175834
answers8/has -615985820
answers8/method 1361691894
answers8/frozen -506613620
answers8/sealed -1392228398
answers8/closed -277139214
answers8/fixedValue 1005674845
answers8/fixedWritable 1378029184
answers8/getterOnly 85564686
answers8/setterOnly -1823638186
answers8/looseAccessor -24165450
answers8/grown 201702426
answers8/shrunk 1983706758
answers8/array 643505923
answers8/frozenArray 904621963
answers8/fn 1452311970
answers8/bare 1379095786
answers8/instance -1290496634
answers8/proxy 1752310236
answers8/bareProxy 1181792144
answers8/map -35429680
answers8/text -1217788135
answers9/empty 820059173
answers9/has -1343875173
answers9/method 1218313003
answers9/frozen -2122526935
answers9/sealed 247556231
answers9/closed -1456028217
answers9/fixedValue 2114221139
answers9/fixedWritable -1957511417
answers9/getterOnly 1572685694
answers9/setterOnly -713642856
answers9/looseAccessor 1338600757
answers9/grown -138477399
answers9/shrunk -432119749
answers9/array -958609459
answers9/frozenArray 1211339235
answers9/fn -2033183753
answers9/bare -784129985
answers9/instance 1786639739
answers9/proxy 2012677555
answers9/bareProxy 1082636855
answers9/map 341321783
answers9/text 593195341
answers10/empty -1526758794
answers10/has -1149054182
answers10/method 1666373010
answers10/frozen -1852757464
answers10/sealed 1388150980
answers10/closed -673215368
answers10/fixedValue -2117980534
answers10/fixedWritable -194852770
answers10/getterOnly 787636858
answers10/setterOnly 1241112873
answers10/looseAccessor 557218262
answers10/grown -957392562
answers10/shrunk -469613318
answers10/array -1077386693
answers10/frozenArray 1553273139
answers10/fn -252579296
answers10/bare 935072948
answers10/instance 543792122
answers10/proxy -1891118870
answers10/bareProxy 1645056578
answers10/map 1240469122
answers10/text -1218816339
answers11/empty 1435083940
answers11/has -919724568
answers11/method -2119246218
answers11/frozen -1350437343
answers11/sealed 1183736496
answers11/closed 888579984
answers11/fixedValue -1680342499
answers11/fixedWritable 1156623728
answers11/getterOnly 1811809526
answers11/setterOnly -640031866
answers11/looseAccessor 1502673924
answers11/grown -1785900356
answers11/shrunk -315496626
answers11/array 2122827924
answers11/frozenArray -766481678
answers11/fn -362816104
answers11/bare 95334756
answers11/instance 1032949134
answers11/proxy -1396273032
answers11/bareProxy 668030352
answers11/map -1781287152
answers11/text 177011536
answers12/empty 1132844947
answers12/has 1166992695
answers12/method 400941691
answers12/frozen -677466736
answers12/sealed 1363594029
answers12/closed -821632799
answers12/fixedValue -1318310499
answers12/fixedWritable -1142691845
answers12/getterOnly -828211357
answers12/setterOnly 826761512
answers12/looseAccessor 615132403
answers12/grown -1511847061
answers12/shrunk 1215785955
answers12/array -1088383976
answers12/frozenArray 862190948
answers12/fn -140198519
answers12/bare -1777811555
answers12/instance -200454813
answers12/proxy -2094425209
answers12/bareProxy 1172680415
answers12/map -360379489
answers12/text 437730178
answers13/empty 685336740
answers13/has -139244786
answers13/method 405010882
answers13/frozen 1113094809
answers13/sealed 970062586
answers13/closed 185232762
answers13/fixedValue -1314735266
answers13/fixedWritable 664869474
answers13/getterOnly 1272975166
answers13/setterOnly 654022355
answers13/looseAccessor -842062188
answers13/grown -928278176
answers13/shrunk -666396190
answers13/array 143235452
answers13/frozenArray 1308117506
answers13/fn 631715802
answers13/bare 250151402
answers13/instance 955303458
answers13/proxy 378410358
answers13/bareProxy -482543054
answers13/map 1705231922
answers13/text 1469314092
317460
*/
