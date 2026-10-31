// RUN: lower
// OPTIONS: builtin-modules

// The arms of these unions have the same property names and differ only in the type of a nested object.
// Each object fits one arm, whichever object came before it.
function tell(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + f());
  } catch (e) {
    console.log(name + ": " + String(e).split("\n")[0]);
  }
}

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("three arms, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "two", outer: { inner: { two: "2" } } },
    { spec: "one", outer: { inner: { one: "1" } } },
    { spec: "other", outer: { other: { one: "w" } } },
    { spec: "two again", outer: { inner: { two: "2" } } },
    { spec: "one again", outer: { inner: { one: "1" } } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("the other order, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "one", outer: { inner: { one: "1" } } },
    { spec: "two", outer: { inner: { two: "2" } } },
    { spec: "other", outer: { other: { one: "w" } } },
    { spec: "one again", outer: { inner: { one: "1" } } },
    { spec: "two again", outer: { inner: { two: "2" } } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, app, pkg } of rows) {
      tell("package files, " + spec, () => JSON.stringify({ name: "app", ...app }));
      tell("package files, " + spec, () => JSON.stringify({ name: "pkg", ...pkg }));
    }
  },
  0,
  [
    { spec: "a star", app: { dependencies: { pkg: "*" } }, pkg: {} },
    { spec: "a star and a version", app: { dependencies: { pkg: "*" } }, pkg: { version: "1.0.0-alpha" } },
    { spec: "an alias", app: { dependencies: { aliased: "npm:pkg@*" } }, pkg: {} },
    { spec: "a catalog", app: { dependencies: { pkg: "catalog:" } }, pkg: { version: "1.0.0" } },
    { spec: "another alias", app: { dependencies: { aliased: "workspace:pkg@*" } }, pkg: {} },
    { spec: "two kinds", app: { devDependencies: { pkg: "workspace:*" }, peerDependencies: { pkg: "^1.0.0" } }, pkg: { version: "1.0.0" } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("two levels down, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "two", outer: { middle: { inner: { two: 2 } } } },
    { spec: "one", outer: { middle: { inner: { one: 1 } } } },
    { spec: "other", outer: { other: 1 } },
    { spec: "two again", outer: { middle: { inner: { two: 2 } } } },
  ],
);

// GENERATED: tell
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Call v1 calleeName="f"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v12 = CatchValue
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string=": "
// CHECK-NEXT: v19 = Add v0, v18
// CHECK-NEXT: v20 = Builtin builtin=String
// CHECK-NEXT: v21 = Call v20, -, v12 calleeName="String"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = PropGet v22 key="split"
// CHECK-NEXT: v24 = String string="\n"
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="split" calleeName="split"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: v28 = ElemGet v26, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v30 = Add v19, v29
// CHECK-NEXT: v31 = Call v17, v15, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
