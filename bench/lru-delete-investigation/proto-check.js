// Check: does a 143-prop prototype become a cacheable dictionary?
// And what happens to IC on prototype chain after delete?

function dictKind(o) {
    // describe() includes "Dictionary" / "UncacheableDictionary" when applicable
    var s = describe(o);
    if (s.indexOf("UncacheableDictionary") !== -1) return "UncacheableDictionary";
    if (s.indexOf("Dictionary") !== -1) return "CacheableDictionary";
    return "NonDictionary";
}

// Case A: synthetic prototype with 143 props added via defineProperty (like DOM bindings)
function makeProto(n, useDefine) {
    var P = {};
    for (var i = 0; i < n; i++) {
        if (useDefine)
            Object.defineProperty(P, "p" + i, { value: i, writable: true, configurable: true, enumerable: true });
        else
            P["p" + i] = i;
    }
    return P;
}

print("=== synthetic proto, 143 props via assignment ===");
var P1 = makeProto(143, false);
print("  before use-as-proto: " + dictKind(P1));
var child1 = Object.create(P1);
child1.x; // access via proto
print("  after use-as-proto:  " + dictKind(P1));
delete P1.p50;
print("  after delete p50:    " + dictKind(P1));

print("=== synthetic proto, 143 props via defineProperty ===");
var P2 = makeProto(143, true);
print("  before use-as-proto: " + dictKind(P2));
var child2 = Object.create(P2);
child2.x;
print("  after use-as-proto:  " + dictKind(P2));
delete P2.p50;
print("  after delete p50:    " + dictKind(P2));

print("=== real built-in prototype (Intl.DateTimeFormat.prototype, has many props after reify) ===");
var dtf = Intl.DateTimeFormat.prototype;
var nProps = Object.keys(Object.getOwnPropertyDescriptors(dtf)).length;
print("  props: " + nProps + ", kind: " + dictKind(dtf));

// Case B: what about when proto is flattened by JSC automatically?
print("=== check mayBePrototype flattening ===");
var P3 = makeProto(200, false);
print("  200-prop obj kind: " + dictKind(P3));
var child3 = Object.create(P3);
// Access properties through child to trigger prototype IC machinery
for (var i = 0; i < 1000; i++) { var x = child3.p50; }
print("  after 1000 child accesses: " + dictKind(P3));
$vm.flattenDictionaryObject(P3);
print("  after explicit flatten: " + dictKind(P3));
