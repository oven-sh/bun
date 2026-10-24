// Sloppy code (CommonJS). A static field is frozen, sealed, made read-only, hidden from enumeration, turned into an accessor or deleted through an alias, between stores and reads that are resolved from the class declaration. A sloppy store that fails does nothing, a strict one throws. The limit in the .json file gives each side of a class one member guard, so every change runs on a class whose only static member is guarded (N) and on a class with two static members, one of which takes the generic path (W).
var sums;
var setterCalls = 0;

function run(use, change) {
  sums = { steps: 0, n: 0, w: 0, b: 0, s: 0 };
  var outcome = "finished";
  try {
    use(change);
  } catch (error) {
    outcome = error instanceof TypeError ? "TypeError" : "another error";
  }
  return outcome + ": " + Object.entries(sums).map(function (entry) { return entry[0] + " " + entry[1]; }).join(", ");
}

function attempt(store) {
  try {
    store(9);
    return "stored";
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function describe(target) {
  var descriptor = Object.getOwnPropertyDescriptor(target, "f");
  if (!descriptor) return "absent";
  var kind = "value" in descriptor ? String(descriptor.value) : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
  return kind + ":" + (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
}

function doNothing() {}

function check(title, use, strict, getTargets, change) {
  function changeThroughAlias() {
    for (var alias of [{}, function () {}].concat(getTargets())) change(alias);
  }
  console.log(title);
  console.log("  before " + run(use, doNothing));
  console.log("  during " + run(use, changeThroughAlias));
  console.log("  after " + run(use, doNothing));
  console.log("  strict stores " + attempt(strict.storeN) + ", " + attempt(strict.storeW));
  console.log("  " + getTargets().map(describe).join(", "));
}

class N1 { static f = 4; }
class W1 { static f = 4; static s() { return 3; } }
class B1 extends W1 {}
class Strict1 { static storeN(value) { N1.f = value; } static storeW(value) { W1.f = value; } }
function use1(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N1.f = i & 3;
    W1.f = i & 3;
    sums.n += N1.f;
    sums.w += W1.f;
    sums.b += B1.f;
    sums.s += B1.s();
  }
}
check("the class is frozen", use1, Strict1, function () { return [N1, W1]; }, function (alias) { Object.freeze(alias); });

class N2 { static f = 4; }
class W2 { static f = 4; static s() { return 3; } }
class B2 extends W2 {}
class Strict2 { static storeN(value) { N2.f = value; } static storeW(value) { W2.f = value; } }
function use2(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N2.f = i & 3;
    W2.f = i & 3;
    sums.n += N2.f;
    sums.w += W2.f;
    sums.b += B2.f;
    sums.s += B2.s();
  }
}
check("the class is sealed", use2, Strict2, function () { return [N2, W2]; }, function (alias) { Object.seal(alias); });

class N3 { static f = 4; }
class W3 { static f = 4; static s() { return 3; } }
class B3 extends W3 {}
class Strict3 { static storeN(value) { N3.f = value; } static storeW(value) { W3.f = value; } }
function use3(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N3.f = i & 3;
    W3.f = i & 3;
    sums.n += N3.f;
    sums.w += W3.f;
    sums.b += B3.f;
    sums.s += B3.s();
  }
}
check("f becomes read-only", use3, Strict3, function () { return [N3, W3]; }, function (alias) { Object.defineProperty(alias, "f", { value: 7, writable: false }); });

class N4 { static f = 4; }
class W4 { static f = 4; static s() { return 3; } }
class B4 extends W4 {}
class Strict4 { static storeN(value) { N4.f = value; } static storeW(value) { W4.f = value; } }
function use4(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N4.f = i & 3;
    W4.f = i & 3;
    sums.n += N4.f;
    sums.w += W4.f;
    sums.b += B4.f;
    sums.s += B4.s();
  }
}
check("f is hidden from enumeration", use4, Strict4, function () { return [N4, W4]; }, function (alias) { Object.defineProperty(alias, "f", { enumerable: false }); });

class N5 { static f = 4; }
class W5 { static f = 4; static s() { return 3; } }
class B5 extends W5 {}
class Strict5 { static storeN(value) { N5.f = value; } static storeW(value) { W5.f = value; } }
function use5(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N5.f = i & 3;
    W5.f = i & 3;
    sums.n += N5.f;
    sums.w += W5.f;
    sums.b += B5.f;
    sums.s += B5.s();
  }
}
check("f becomes a getter and a setter", use5, Strict5, function () { return [N5, W5]; }, function (alias) { Object.defineProperty(alias, "f", { get() { return 50; }, set(value) { setterCalls++; }, configurable: true }); });
console.log("  setter calls " + setterCalls);

class N6 { static f = 4; }
class W6 { static f = 4; static s() { return 3; } }
class B6 extends W6 {}
class Strict6 { static storeN(value) { N6.f = value; } static storeW(value) { W6.f = value; } }
function use6(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N6.f = i & 3;
    W6.f = i & 3;
    sums.n += N6.f;
    sums.w += W6.f;
    sums.b += B6.f;
    sums.s += B6.s();
  }
}
check("f becomes a getter", use6, Strict6, function () { return [N6, W6]; }, function (alias) { Object.defineProperty(alias, "f", { get() { return 60; }, configurable: true }); });

class N7 { static f = 4; }
class W7 { static f = 4; static s() { return 3; } }
class B7 extends W7 {}
class Strict7 { static storeN(value) { N7.f = value; } static storeW(value) { W7.f = value; } }
function use7(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N7.f = i & 3;
    W7.f = i & 3;
    sums.n += N7.f;
    sums.w += W7.f;
    sums.b += B7.f;
    sums.s += B7.s();
  }
}
check("f is deleted", use7, Strict7, function () { return [N7, W7]; }, function (alias) { delete alias.f; });

class N8 { static f = 4; }
class W8 { static f = 4; static s() { return 3; } }
class B8 extends W8 {}
class Strict8 { static storeN(value) { N8.f = value; } static storeW(value) { W8.f = value; } }
function use8(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N8.f = i & 3;
    W8.f = i & 3;
    sums.n += N8.f;
    sums.w += W8.f;
    sums.b += B8.f;
    sums.s += B8.s();
  }
}
check("f is deleted from a class that is not extensible", use8, Strict8, function () { return [N8, W8]; }, function (alias) { Object.preventExtensions(alias); delete alias.f; });

class N9 { static f = 4; }
class W9 { static f = 4; static s() { return 3; } }
class B9 extends W9 {}
class Strict9 { static storeN(value) { N9.f = value; } static storeW(value) { W9.f = value; } }
function use9(change) {
  for (var i = 0; i < 1000; i++) {
    if (i === 500) change();
    sums.steps++;
    N9.f = i & 3;
    W9.f = i & 3;
    sums.n += N9.f;
    sums.w += W9.f;
    sums.b += B9.f;
    sums.s += B9.s();
  }
}
check("no change: f is defined with the attributes it has", use9, Strict9, function () { return [N9, W9]; }, function (alias) { Object.defineProperty(alias, "f", { value: 8, writable: true, enumerable: true, configurable: true }); });

module.exports = 0;
