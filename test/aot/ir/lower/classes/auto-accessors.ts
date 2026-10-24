// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewClass [[constructor]]
// CHECK: DefineMethod [[head]], {{*}}layout=[[layout]] methodKind=Getter key="a"
// CHECK: DefineMethod [[head]], {{*}}layout=[[layout]] methodKind=Setter index=1 key="a"
// CHECK: DefineMethod [[head]], {{*}}layout=[[layout]] side=Static methodKind=Getter index=2 key="b"
// CHECK: DefineMethod [[head]], {{*}}layout=[[layout]] side=Static methodKind=Setter index=3 key="b"
// CHECK: [[key]] = ToPropertyKey
// CHECK: DefineMethod [[head]], [[getter]], [[key]] layout=[[layout]] methodKind=Getter index=4 @
// CHECK: DefineMethod [[head]], [[setter]], [[key]] layout=[[layout]] methodKind=Setter index=5 @
// CHECK: = FinishClass [[head]]

// RUN(PIECES): lower
// PIECES-COUNT-6: DefineMethod
// PIECES-NOT: DefineMethod

// RUN(BODIES): lower
// BODIES-LABEL: function {{*}}name="a" {{*}}kind=Getter
// BODIES: = PrivateGet {{*}}field=1 @
// BODIES-LABEL: function {{*}}name="a" {{*}}kind=Setter
// BODIES: PrivateSet {{*}}field=1 @
// BODIES-LABEL: function {{*}}name="b" {{*}}kind=Getter
// BODIES-NOT: PrivateGet
// BODIES: = StrictEq
// BODIES: = GetModuleVariable
// BODIES-LABEL: function {{*}}name="b" {{*}}kind=Setter

// RUN(BRAND): lower
// BRAND-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor
// BRAND: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// BRAND-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]] flags=[IsFromCompiler]}
// BRAND: PrivateDefine [[this]], [[token]], [[token]] layout=[[layout]] @
// BRAND-NEXT: = CallDirect [[this]] function=
// BRAND-LABEL: function {{*}}kind=Initializer{{*}}thisType={type=L{{*}} flags=[IsFromCompiler]}
// BRAND: PrivateDefine {{*}}field=1 @
// BRAND: PrivateDefine {{*}}field=2 @

// RUN(HELPERS): lower
// HELPERS-NOT: CompilerHelpers

declare const k: string;

export class C {
  accessor a = 1;
  static accessor b = 2;
  accessor [k] = 3;
}
