// RUN: lower
// DIAGNOSTIC: TS1211 3

{ class {} }
namespace N { class {} }
function f() { class {} }
f();
