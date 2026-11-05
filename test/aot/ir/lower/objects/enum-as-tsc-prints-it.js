// What tsc prints for an enum in a .js file. The function only fills an object that nobody has seen, so the object is born with its members and the function is not called.
// Flow folds a member that every creation fills and nobody stores to, and `switch (state) { case State.A: }` becomes a table.

// RUN(BORN): lower
// BORN-LABEL: function {{*}}name="born"
// BORN-NOT: NewClosure
// BORN: [[head]] = NewObject {{*}}fields=[0, 1, 2]
// BORN: ElemDefine [[head]]
// BORN: ElemDefine [[head]]
// BORN-NOT: ElemDefine
// BORN: FinishObject [[head]]
// BORN-NOT: Call
// BORN: Return

// As esbuild, Bun, swc and Babel print it: the function returns the object.
// RUN(RETURNED): lower
// RETURNED-LABEL: function {{*}}name="returned"
// RETURNED-NOT: NewClosure
// RETURNED: [[head]] = NewObject {{*}}fields=[0, 1]
// RETURNED: ElemDefine [[head]]
// RETURNED: FinishObject [[head]]
// RETURNED-NOT: Call
// RETURNED: Return

// As newer swc prints it: the object is written where it is passed.
// RUN(BARE): lower
// BARE-LABEL: function {{*}}name="bareLiteral"
// BARE-NOT: NewClosure
// BARE: [[head]] = NewObject {{*}}fields=[0]
// BARE: ElemDefine [[head]]
// BARE: FinishObject [[head]]
// BARE-NOT: Call
// BARE: Return

// RUN(NOTHING): lower
// NOTHING-LABEL: function {{*}}name="returnsNothing"
// NOTHING: Call
// NOTHING: Return

// The variable has a value when the statement runs, or may have one: the function is called.
// RUN(GIVEN): lower
// GIVEN-LABEL: function {{*}}name="given"
// GIVEN: Call
// GIVEN: Return

// RUN(TWICE): lower
// TWICE-LABEL: function {{*}}name="declaredTwice"
// TWICE: Call
// TWICE: Call
// TWICE: Return

// RUN(LOOP): lower
// LOOP-LABEL: function {{*}}name="inLoop"
// LOOP: Call
// LOOP: Return

// The function does more than fill the object.
// RUN(MORE): lower
// MORE-LABEL: function {{*}}name="computedMember"
// MORE: Call
// MORE: Return

export function born() {
  var E;
  (function (E) {
    E[(E["A"] = 0)] = "A";
    E[(E["B"] = 5)] = "B";
    E["C"] = "c";
  })(E || (E = {}));
  return E;
}

export function returned() {
  var E = /* @__PURE__ */ (E2 => {
    E2[(E2["A"] = 0)] = "A";
    E2["C"] = "c";
    return E2;
  })(E || {});
  return E;
}

export function bareLiteral() {
  return (function (E) {
    E[(E["A"] = 0)] = "A";
    return E;
  })({});
}

export function returnsNothing() {
  var E = (E2 => {
    E2[(E2["A"] = 0)] = "A";
  })(E || {});
  return E;
}

export function given() {
  var E = { already: true };
  (function (E) {
    E[(E["A"] = 0)] = "A";
  })(E || (E = {}));
  return E;
}

export function declaredTwice() {
  var E;
  (function (E) {
    E[(E["A"] = 0)] = "A";
  })(E || (E = {}));
  (function (E) {
    E[(E["B"] = 1)] = "B";
  })(E || (E = {}));
  return E;
}

export function inLoop() {
  for (let turn = 0; turn < 2; turn++) {
    var E;
    (function (E) {
      E[(E["A"] = 0)] = "A";
    })(E || (E = {}));
  }
  return E;
}

export function computedMember() {
  var E;
  (function (E) {
    E[(E["A"] = 1)] = "A";
    E[(E["B"] = E.A << 2)] = "B";
  })(E || (E = {}));
  return E;
}
