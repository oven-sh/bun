function dictKind(o) {
    var s = describe(o);
    if (s.indexOf("UncacheableDictionary") !== -1) return "UncacheableDictionary";
    if (s.indexOf("Dictionary") !== -1) return "CacheableDictionary";
    return "NonDictionary";
}

// Does JSC re-flatten an UNCACHEABLE dictionary prototype when hot?
print("=== uncacheable-dict proto, hot child access ===");
var P = {};
for (var i = 0; i < 200; i++) P["p" + i] = i;
var child = Object.create(P);
print("  proto kind (200 props): " + dictKind(P));
delete P.p50;  // with patch → UncacheableDictionary
print("  after delete p50: " + dictKind(P));
// Now hammer child accesses
function get(c) { return c.p100; }
noInline(get);
for (var i = 0; i < 20000; i++) get(child);
print("  after 20000 child.p100: " + dictKind(P));

// And how about actual perf: IC on child access after proto went uncacheable
print("=== perf: child access through uncacheable-dict proto ===");
var P2 = {};
for (var i = 0; i < 200; i++) P2["p" + i] = i;
var child2 = Object.create(P2);
delete P2.p50;
print("  proto kind after delete: " + dictKind(P2));
function get2(c) { return c.p100 + c.p101 + c.p102; }
noInline(get2);
// warmup
for (var i = 0; i < 1000; i++) get2(child2);
print("  proto kind after warmup: " + dictKind(P2));
var t0 = Date.now();
var sum = 0;
for (var i = 0; i < 1000000; i++) sum += get2(child2);
print("  1M child accesses: " + (Date.now() - t0) + " ms, kind=" + dictKind(P2));
