// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK: [[head]] = NewObject layout=[[layout]]
// CHECK-NEXT: [[created]] = FinishObject [[head]]
// CHECK: PutModuleVariable [[created]] variable=[[exports]]
// CHECK: PropSet {{*}}key="a"
// CHECK: PropSet {{*}}key="b"
// CHECK: Return

// RUN(NOWHERE): lower
// NOWHERE-NOT: ToThis
// NOWHERE-NOT: testedType=undefined
// NOWHERE-NOT: key="exports"
// NOWHERE-NOT: ModuleBuiltin
// NOWHERE-NOT: builtin(ModuleObjectExports)

// RUN(RECORDS): link
// RECORDS: layout [[layout]] module=[[entry]] fields=[{key="a" declared={type=anything}}, {key="b" declared={type=anything}}]
// RECORDS: module [[entry]] path="{{*}}commonjs-creates-exports{{*}}displayPath="{{*}}" kind=CommonJs{{*}}exportsVariable=g

// An entry point is a module whose exports are an object: the host may ask what it exports. The body has no parameters. It makes the object and stores it into the variable that stands for `module.exports`; `exports` and top-level `this` are that variable.
exports.a = 1;
this.b = exports.a;
