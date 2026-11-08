// RUN: lower
// OPTIONS: builtin-modules

// Static private fields of every type are read, tested with `in` and written before their initializer has run, in classes created inside a function.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function show(v: unknown) { return typeof v === "function" || typeof v === "object" ? typeof v : String(v); }
function make_number(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= 5; return "or"; }
    static nullish() { (K as any).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made number " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made number " + round + " " + when + " write", () => K.write(5));
      row("made number " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: number = 5;
    static { K.all("behind"); }
} return K; }
make_number(1); make_number(2).all("later");
function make_string(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: string) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += "x"; return "added"; }
    static increment() { (K as any).#b += "y"; return "incremented"; }
    static or() { (K as any).#b ||= "five"; return "or"; }
    static nullish() { (K as any).#b ??= "five"; return "nullish"; }
    static pattern() { [K.#b] = ["five"]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made string " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made string " + round + " " + when + " write", () => K.write("five"));
      row("made string " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: string = "five";
    static { K.all("behind"); }
} return K; }
make_string(1); make_string(2).all("later");
function make_boolean(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: boolean) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= false; return "added"; }
    static increment() { (K as any).#b ||= true; return "incremented"; }
    static or() { (K as any).#b ||= true; return "or"; }
    static nullish() { (K as any).#b ??= true; return "nullish"; }
    static pattern() { [K.#b] = [true]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made boolean " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made boolean " + round + " " + when + " write", () => K.write(true));
      row("made boolean " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: boolean = true;
    static { K.all("behind"); }
} return K; }
make_boolean(1); make_boolean(2).all("later");
function make_object(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: { v: number }) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= { v: 6 }; return "added"; }
    static increment() { (K as any).#b &&= { v: 7 }; return "incremented"; }
    static or() { (K as any).#b ||= { v: 5 }; return "or"; }
    static nullish() { (K as any).#b ??= { v: 5 }; return "nullish"; }
    static pattern() { [K.#b] = [{ v: 5 }]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made object " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made object " + round + " " + when + " write", () => K.write({ v: 5 }));
      row("made object " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: { v: number } = { v: 5 };
    static { K.all("behind"); }
} return K; }
make_object(1); make_object(2).all("later");
function make_nullable(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: number | undefined) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= undefined; return "or"; }
    static nullish() { (K as any).#b ??= undefined; return "nullish"; }
    static pattern() { [K.#b] = [undefined]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made nullable " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made nullable " + round + " " + when + " write", () => K.write(undefined));
      row("made nullable " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: number | undefined = undefined;
    static { K.all("behind"); }
} return K; }
make_nullable(1); make_nullable(2).all("later");
function make_function(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: () => number) { K.#b = v; return "stored"; }
    static add() { (K as any).#b &&= () => 6; return "added"; }
    static increment() { (K as any).#b &&= () => 7; return "incremented"; }
    static or() { (K as any).#b ||= () => 5; return "or"; }
    static nullish() { (K as any).#b ??= () => 5; return "nullish"; }
    static pattern() { [K.#b] = [() => 5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made function " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made function " + round + " " + when + " write", () => K.write(() => 5));
      row("made function " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: () => number = () => 5;
    static { K.all("behind"); }
} return K; }
make_function(1); make_function(2).all("later");
function make_anything(round: number) { class K {
    static has() { return #b in K; }
    static read() { return show(K.#b); }
    static readThis() { return show(this.#b); }
    static write(v: any) { K.#b = v; return "stored"; }
    static add() { (K as any).#b += 1; return "added"; }
    static increment() { (K as any).#b++; return "incremented"; }
    static or() { (K as any).#b ||= 5; return "or"; }
    static nullish() { (K as any).#b ??= 5; return "nullish"; }
    static pattern() { [K.#b] = [5]; return "pattern"; }
    static call() { return (K as any).#b(); }
    static kind() { return typeof K.#b; }
    static all(when: string) {
      for (const door of ["has", "read", "readThis", "kind", "add", "increment", "or", "nullish", "pattern", "call", "has", "read"]) row("made anything " + round + " " + when + " " + door, () => (K as any)[door]());
      row("made anything " + round + " " + when + " write", () => K.write(5));
      row("made anything " + round + " " + when + " has behind the write", () => K.has());
    }
    static { K.all("in a block ahead"); }
    static #b: any = 5;
    static { K.all("behind"); }
} return K; }
make_anything(1); make_anything(2).all("later");

// GENERATED: said show make_number
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b3(), notTaken b1(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = TypeTest v3 testedType=function
// CHECK-NEXT: Branch v4 -> taken b4(), notTaken b2(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = TypeTest v5 testedType=null|object
// CHECK-NEXT: Branch v6 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = TypeOf v0
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v3 calleeName="String"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make_number"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_4]]
// CHECK-NEXT: v4 = NewClosure v1, v3 function=[[f_5]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_4]] side=Static key="has"
// CHECK-NEXT: v6 = NewClosure v1, v3 function=[[f_6]]
// CHECK-NEXT: DefineMethod v3, v6 layout=[[L_4]] side=Static index=1 key="read"
// CHECK-NEXT: v8 = NewClosure v1, v3 function=[[f_7]]
// CHECK-NEXT: DefineMethod v3, v8 layout=[[L_4]] side=Static index=2 key="readThis"
// CHECK-NEXT: v10 = NewClosure v1, v3 function=[[f_8]]
// CHECK-NEXT: DefineMethod v3, v10 layout=[[L_4]] side=Static index=3 key="write"
// CHECK-NEXT: v12 = NewClosure v1, v3 function=[[f_9]]
// CHECK-NEXT: DefineMethod v3, v12 layout=[[L_4]] side=Static index=4 key="add"
// CHECK-NEXT: v14 = NewClosure v1, v3 function=[[f_10]]
// CHECK-NEXT: DefineMethod v3, v14 layout=[[L_4]] side=Static index=5 key="increment"
// CHECK-NEXT: v16 = NewClosure v1, v3 function=[[f_11]]
// CHECK-NEXT: DefineMethod v3, v16 layout=[[L_4]] side=Static index=6 key="or"
// CHECK-NEXT: v18 = NewClosure v1, v3 function=[[f_12]]
// CHECK-NEXT: DefineMethod v3, v18 layout=[[L_4]] side=Static index=7 key="nullish"
// CHECK-NEXT: v20 = NewClosure v1, v3 function=[[f_13]]
// CHECK-NEXT: DefineMethod v3, v20 layout=[[L_4]] side=Static index=8 key="pattern"
// CHECK-NEXT: v22 = NewClosure v1, v3 function=[[f_14]]
// CHECK-NEXT: DefineMethod v3, v22 layout=[[L_4]] side=Static index=9 key="call"
// CHECK-NEXT: v24 = NewClosure v1, v3 function=[[f_15]]
// CHECK-NEXT: DefineMethod v3, v24 layout=[[L_4]] side=Static index=10 key="kind"
// CHECK-NEXT: v26 = NewClosure v1, v0 function=[[f_16]]
// CHECK-NEXT: DefineMethod v3, v26 layout=[[L_4]] side=Static index=11 key="all"
// CHECK-NEXT: v28 = FinishClass v3 layout=[[L_4]]
// CHECK-NEXT: v29 = Convert v28 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: PutEnvironmentField v1, v29 layout=[[L_2]]
// CHECK-NEXT: v31 = Convert v28 declared={type=function flags=[IsFromCompiler]}
// CHECK-NEXT: v32 = CallDirect v1, v3, v31 function=[[f_17]]
// CHECK-NEXT: v33 = Convert v28 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
