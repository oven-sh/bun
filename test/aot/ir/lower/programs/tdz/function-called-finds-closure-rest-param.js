// RUN: lower
// OPTIONS: builtin-modules

// A function that is called once finds the closure in a rest parameter, in a default value, in arguments.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let r;
try { r = ((...a) => a[0]())(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
try { r = ((f, g = f) => g())(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
try { r = (function (a) { return arguments[1](); })(0, () => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
const later = { x: 1 };
console.log(later.x);

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
