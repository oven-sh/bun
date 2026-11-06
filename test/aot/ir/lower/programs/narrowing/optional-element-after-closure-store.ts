// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A nested function assigns the variable. TypeScript still narrows it to the `undefined` or `null` that was stored first, so it types `a?.[0]` as `undefined`.
// The element that is read is whatever the array holds.
function later(f: () => void) {
  f();
}
function tell(name: string, make: () => unknown) {
  try {
    console.log(name + ": " + JSON.stringify(make()));
  } catch (e) {
    console.log(name + ": " + (e as Error).name + ": " + (e as Error).message.split("\n")[0]);
  }
}
tell("returned", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return a?.[0];
});
tell("in an array literal", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return [a?.[0]];
});
tell("in an object literal", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return { first: a?.[0] };
});
tell("as an argument", () => {
  let a: number[] | undefined = undefined;
  later(() => {
    a = [7];
  });
  // @ts-ignore
  return String(a?.[0]);
});
tell("by a name in brackets", () => {
  let o: { open: boolean } | null = null;
  later(() => {
    o = { open: true };
  });
  // @ts-ignore
  return [o?.["open"]];
});
tell("beside a call and a member", () => {
  let f: (() => string) | undefined = undefined,
    a: number[] | undefined = undefined,
    o: { m: string } | undefined = undefined;
  later(() => {
    f = () => "f";
    a = [7];
    o = { m: "m" };
  });
  // @ts-ignore
  return [f?.(), a?.[0], o?.m];
});
tell("further down the chain", () => {
  let a: { n: number }[] | undefined = undefined;
  later(() => {
    a = [{ n: 7 }];
  });
  // @ts-ignore
  return [a?.[0].n, a?.[0]?.n];
});
tell("never assigned", () => {
  let a: number[] | undefined = undefined;
  later(() => {});
  // @ts-ignore
  return [a?.[0]];
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: tell f
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
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v1 calleeName="make"
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v8, v14
// CHECK-NEXT: v16 = Call v6, v4, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v17 = CatchValue
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string=": "
// CHECK-NEXT: v24 = Add v0, v23
// CHECK-NEXT: v25 = Convert v17 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = PropGet v25 key="name"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = Add v24, v27
// CHECK-NEXT: v29 = String string=": "
// CHECK-NEXT: v30 = Add v28, v29
// CHECK-NEXT: v31 = PropGet v25 key="message"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v33 = PropGet v32 key="split"
// CHECK-NEXT: v34 = String string="\n"
// CHECK-NEXT: v35 = Call v33, v32, v34 calleeKey="split" calleeName="e.message.split"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Array<undefined|null|string> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Integer
// CHECK-NEXT: v38 = ElemGet v36, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v40 = Add v30, v39
// CHECK-NEXT: v41 = Call v22, v20, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="f"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
