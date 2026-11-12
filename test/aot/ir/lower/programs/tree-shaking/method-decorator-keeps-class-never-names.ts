// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// With experimentalDecorators a method decorator gets the prototype, a static one the constructor, a property decorator and a parameter decorator the prototype too. Each keeps what it got; the classes are named nowhere.
const kept: [string, any][] = [];

function keep(label: string) {
  return (target: any, ...rest: unknown[]): void => {
    kept.push([label, typeof target === "function" ? target : target.constructor]);
  };
}

class ByMethod {
  @keep("method") marked(): void {}
  run(): string {
    return "by method";
  }
}

class ByStaticMethod {
  @keep("static method") static marked(): void {}
  run(): string {
    return "by static method";
  }
}

class ByProperty {
  @keep("property") marked = 1;
  run(): string {
    return "by property " + this.marked;
  }
}

class ByParameter {
  marked(@keep("parameter") value: number): void {}
  run(): string {
    return "by parameter";
  }
}

class ByAccessor {
  @keep("accessor") get marked(): number {
    return 1;
  }
  run(): string {
    return "by accessor " + this.marked;
  }
}

for (const [label, constructor] of kept) console.log(label + ": " + new constructor().run());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true } }

// GENERATED: keep marked ByProperty
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_1]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="marked"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="marked"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ByProperty"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: PropSet v3, v5 key="marked"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="marked"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="marked"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
