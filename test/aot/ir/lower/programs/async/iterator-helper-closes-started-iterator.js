// RUN: lower
// OPTIONS: builtin-modules

// An iterator helper that has started closes its underlying iterator once: when its return() is called, when a loop over it exits early, and when its callback throws. The result of the underlying return() must be an object, and an error of the callback wins over an error of return().
const log = [];
function underlying(close = () => ({})) {
  let count = 0;
  return {
    __proto__: Iterator.prototype,
    next() {
      log.push("next");
      return { value: ++count, done: false };
    },
    return() {
      log.push("return");
      return close();
    },
  };
}
function attempt(label, run) {
  log.length = 0;
  let outcome;
  try {
    outcome = "gives " + JSON.stringify(run());
  } catch (error) {
    outcome = "throws " + (error instanceof Error ? error.name + ": " + error.message : String(error));
  }
  console.log(label + ": " + outcome + " | " + log.join(" "));
}

const helpers = {
  map: (u, callback = x => x) => u.map(callback),
  filter: (u, callback = () => true) => u.filter(callback),
  flatMap: (u, callback = x => [x]) => u.flatMap(callback),
  take: u => u.take(3),
  drop: u => u.drop(1),
};

for (const [name, create] of Object.entries(helpers)) {
  attempt(name + ", next() then return()", () => {
    const helper = create(underlying());
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() twice, then next()", () => {
    const helper = create(underlying());
    helper.next();
    helper.return();
    return [helper.return(), helper.next()];
  });
  attempt(name + ", break out of a loop", () => {
    for (const x of create(underlying())) break;
  });
  attempt(name + ", return out of a loop", () => {
    for (const x of create(underlying())) return x;
  });
  attempt(name + ", throw out of a loop", () => {
    for (const x of create(underlying())) throw "from the loop";
  });
  attempt(name + ", a pattern shorter than the iterator", () => {
    const [first, second] = create(underlying());
    return [first, second];
  });
  for (const primitive of [undefined, null, 1, "text", true]) {
    attempt(name + ", return() gives " + String(primitive), () => {
      const helper = create(underlying(() => primitive));
      helper.next();
      return helper.return();
    });
  }
  attempt(name + ", return() gives a function", () => {
    const helper = create(underlying(() => function () {}));
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() throws", () => {
    const helper = create(underlying(() => { throw "from return()"; }));
    helper.next();
    return helper.return();
  });
  attempt(name + ", return() throws and a loop breaks", () => {
    for (const x of create(underlying(() => { throw "from return()"; }))) break;
  });
  attempt(name + ", return() throws and a loop throws", () => {
    for (const x of create(underlying(() => { throw "from return()"; }))) throw "from the loop";
  });
}

for (const name of ["map", "filter", "flatMap"]) {
  const fail = () => { throw "from the callback"; };
  attempt(name + ", the callback throws", () => helpers[name](underlying(), fail).next());
  attempt(name + ", the callback throws and return() throws", () => helpers[name](underlying(() => { throw "from return()"; }), fail).next());
  attempt(name + ", the callback throws and return() gives a number", () => helpers[name](underlying(() => 1), fail).next());
  attempt(name + ", the callback throws at the second value", () => {
    const helper = helpers[name](underlying(() => { throw "from return()"; }), x => { if (x === 2) throw "from the callback"; return [x]; });
    return [helper.next(), helper.next()];
  });
  attempt(name + ", next() and return() after the callback threw", () => {
    const helper = helpers[name](underlying(), fail);
    try { helper.next(); } catch {}
    return [helper.next(), helper.return()];
  });
}

attempt("flatMap, return() while an inner iterator is open", () => {
  const helper = underlying().flatMap(() => ({
    [Symbol.iterator]() {
      return { next() { log.push("inner next"); return { value: 0, done: false }; }, return() { log.push("inner return"); return {}; } };
    },
  }));
  helper.next();
  return helper.return();
});
attempt("flatMap, the inner return() throws", () => {
  const helper = underlying().flatMap(() => ({
    [Symbol.iterator]() {
      return { next() { return { value: 0, done: false }; }, return() { log.push("inner return"); throw "from the inner return()"; } };
    },
  }));
  helper.next();
  return helper.return();
});
attempt("flatMap, the callback gives a number", () => underlying(() => { throw "from return()"; }).flatMap(() => 1).next());
attempt("take, the limit is reached", () => {
  const helper = underlying().take(1);
  return [helper.next(), helper.next(), helper.next()];
});
attempt("take, the limit is reached and return() gives a number", () => {
  const helper = underlying(() => 1).take(1);
  helper.next();
  return helper.next();
});
attempt("a chain of helpers", () => {
  const helper = underlying().map(x => x + 1).filter(() => true).take(5).drop(0);
  helper.next();
  return helper.return();
});
attempt("an underlying iterator without return()", () => {
  const helper = { __proto__: Iterator.prototype, next() { log.push("next"); return { value: 1, done: false }; } }.map(x => x);
  helper.next();
  return helper.return();
});

// GENERATED: underlying callback [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="underlying"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_3]]
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v9 layout=[[L_3]]
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="Iterator" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Iterator) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="prototype"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(IteratorPrototype) flags=[IsExpected]}
// CHECK-NEXT: v16 = NewClosure v1 function=[[f_5]]
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v18 = NewObject layout=[[L_2]]
// CHECK-NEXT: SetLiteralPrototype v18, v15
// CHECK-NEXT: PropDefine v18, v17 key="next"
// CHECK-NEXT: v21 = NewClosure v7 function=[[f_7]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v18, v22 key="return"
// CHECK-NEXT: v24 = FinishObject v18
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewArray v0 contents=anything
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_12]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v2, v1 key="next"
// CHECK-NEXT: v4 = NewClosure function=[[f_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: PropDefine v2, v5 key="return"
// CHECK-NEXT: v7 = FinishObject v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_14]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v2, v1 key="next"
// CHECK-NEXT: v4 = NewClosure function=[[f_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: PropDefine v2, v5 key="return"
// CHECK-NEXT: v7 = FinishObject v2
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
