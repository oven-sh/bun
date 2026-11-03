// RUN: lower
// CHECK-LABEL: function {{*}}name="named"
// CHECK-NEXT: ([[o]]:
// CHECK: = PropDelete [[o]] key="p" mode=Sloppy
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NEXT: ([[o]]: {{*}}, [[k]]: anything):
// CHECK: = ElemDelete [[o]], [[k]] mode=Sloppy
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: = TypeTest [[o]] testedType=undefined|null
// CHECK: [[chainSkipped]] = Boolean boolean=true
// CHECK-NEXT: Jump -> next [[chainJoin]]([[chainSkipped]])
// CHECK-LABEL: function {{*}}name="parenthesizedChain"
// CHECK: = TypeTest [[o]] testedType=undefined|null
// CHECK: [[parenthesizedSkipped]] = Boolean boolean=true
// CHECK-NEXT: Jump -> next [[parenthesizedJoin]]([[parenthesizedSkipped]])
// CHECK-LABEL: function {{*}}name="variable"
// CHECK-NOT: PropDelete
// CHECK: = Boolean
// CHECK-NOT: boolean=true
// CHECK-NOT: PropDelete
// CHECK-LABEL: function {{*}}name="freeName"
// CHECK: = PropDelete {{*}}key="missing" mode=Sloppy [isFreeName]
// CHECK-LABEL: function {{*}}name="call"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-NEXT: = Boolean boolean=true
// CHECK-LABEL: function {{*}}name="chainTail"
// CHECK-COUNT-1: = TypeTest
// CHECK-NOT: = TypeTest
// CHECK-LABEL: function {{*}}name="classKey"
// CHECK: = PropDelete {{*}}key="outside" mode=Sloppy
// CHECK: = PropDelete {{*}}key="inside"
// CHECK-NOT: mode=Sloppy

// RUN(DELETES): lower
// DELETES-LABEL: function {{*}}name="chain"
// DELETES: = PropDelete {{*}}key="p" mode=Sloppy
// DELETES-LABEL: function {{*}}name="parenthesizedChain"
// DELETES: = PropDelete {{*}}key="p" mode=Sloppy
// DELETES-LABEL: function {{*}}name="chainTail"
// DELETES: [[link]] = PropGet {{*}}key="a"
// DELETES-NEXT: [[convertedLink]] = Convert [[link]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// DELETES-NEXT: = PropDelete [[convertedLink]] key="b" mode=Sloppy

function named(o) {
  return delete o.p;
}

function computed(o, k) {
  return delete o[k];
}

function chain(o) {
  return delete o?.p;
}

function parenthesizedChain(o) {
  return delete (o?.p);
}

function variable() {
  var local;
  return delete local;
}

function freeName() {
  return delete missing;
}

function call(f) {
  return delete f();
}

function chainTail(o) {
  return delete o?.a.b;
}

function classKey(o) {
  delete o.outside;
  return class {
    [delete o.inside]() {}
  };
}

module.exports = { named, computed, chain, parenthesizedChain, variable, freeName, call, chainTail, classKey };
