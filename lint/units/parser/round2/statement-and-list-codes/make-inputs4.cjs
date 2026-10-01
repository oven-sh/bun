// Writes inputs4.json: the argument of the name diagnostics, the keyword suggestions, the lists that end where a statement can. usage: node make-inputs4.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
const B = "\\";
g("the argument of a name diagnostic", [
  "interface )", "interface ]", "interface :", "interface ,", "interface 0x10", "interface 1e3", "interface 1.0", "interface 1_0", "interface .5", "interface 'a\\nb'", "interface \"a\"", "interface if", "interface typeof",
  "interface " + B + "u0061", "interface " + B + "u0076ar", "interface /a/", "interface @", "interface ...", "interface =>", "interface ?", "interface }", "interface ;", "interface", "interface\n1",
  "type )", "type ]", "type :", "type ,", "type 0x10", "type 1e3", "type }", "type \"a b\"", "type if", "type @", "type ...", "type =>", "type ?", "type 1n", "type /a/",
  "namespace )", "namespace ]", "namespace ,", "namespace 0x10", "namespace }", "namespace if", "namespace @", "module )", "module 1e3", "module if", "module ...", "namespace ?", "namespace 1n",
  "{ interface ) }", "function f() { type ) }", "if (a) namespace )", "x: interface 1",
]);
g("keyword suggestions", [
  "asserts123 x", "assertsFoo x", "constructorFoo x", "typeofFoo x", "typeofx x", "interfaceFoo x", "instanceofFoo x", "inferFoo x", "newFoo x", "nullFoo x", "numberFoo x", "voidFoo x", "withFoo x", "whileFoo x", "deleteFoo x",
  "defaultFoo x", "deferFoo x", "declareFoo x", "debuggerFoo x", "returnFoo x", "requireFoo x", "readonlyFoo x", "anyFoo x", "asyncFoo x", "awaitFoo x", "letFoo x", "getFoo x", "setFoo x", "outFoo x", "tryFoo x", "forFoo x",
  "varFo x", "varF x", "var1 x", "letx x", "lets x", "gets x", "sets x", "outs x", "news x", "trys x", "fors x", "vars x", "anys x", "Class x", "CLASS x", "cLass x", "Const x", "LET x", "Var x", "VAR x", "If x", "iF x", "Do x", "In x", "Of x", "As x", "Is x",
  "clas x", "claas x", "calss x", "clsas x", "classe x", "klass x", "cla x", "cl x", "c x", "fnction x", "funtion x", "functoin x", "functionn x", "funct x", "func x", "fun x", "function1 x", "functio x",
  "ocnst x", "cnst x", "conts x", "cosnt x", "consts x", "cons x", "con x", "co x", "constt x", "connst x", "const_ x", "_const x", "xconst x", "constx x", "constxy x", "constxyz x",
  "improt x", "imprt x", "impor x", "imports x", "imp x", "exprt x", "exports x", "exporrt x", "expor x", "retrn x", "returns x", "retur x", "ret x", "retunr x", "swich x", "swtich x", "switc x", "witch x",
  "whlie x", "whil x", "wile x", "whiel x", "thro x", "trow x", "throws x", "thorw x", "typo x", "typ x", "tpye x", "tyep x", "types x", "typee x", "typeo x", "tipeof x", "typof x",
  "interfac x", "inteface x", "interfaces x", "interace x", "namespce x", "namspace x", "namespaces x", "modle x", "modul x", "modules x", "mdule x", "abstact x", "abstrac x", "abstracts x", "asinc x", "asyn x", "asnyc x", "asyncs x", "awai x", "awiat x",
  "yeild x", "yiel x", "yields x", "delet x", "deleet x", "deletes x", "debuger x", "debugge x", "continu x", "contiune x", "continues x", "defalt x", "defaul x", "defaults x", "exten x", "extend x", "extendss x", "implemnts x", "implement x",
  "instaceof x", "instanceo x", "redonly x", "readonl x", "requir x", "requires x", "statc x", "stati x", "statics x", "strin x", "strng x", "strings x", "nubmer x", "numbr x", "numbers x", "booleen x", "boolea x", "booleans x", "symbl x", "symbo x",
  "objec x", "objet x", "objects x", "nevr x", "neve x", "nevers x", "unknwn x", "unknow x", "unknowns x", "bigin x", "bigint1 x", "undefine x", "undefind x", "uniqu x", "uniqe x", "usin x", "usng x", "usings x", "globl x", "globa x", "globals x",
  "overide x", "overrid x", "overrides x", "acessor x", "accesso x", "accessors x", "satisfie x", "satifies x", "keyo x", "kyof x", "keyofs x", "infr x", "infe x", "infers x", "packge x", "packag x", "packages x", "privat x", "privte x", "privates x",
  "protecte x", "protcted x", "publc x", "publi x", "publics x", "enm x", "enu x", "enums x", "flase x", "fals x", "falses x", "ture x", "tru x", "trues x", "nul x", "nulls x", "ths x", "thi x", "thiss x", "supr x", "supe x", "supers x",
  "voi x", "viod x", "voids x", "wth x", "wit x", "withs x", "els x", "esle x", "elses x", "cas x", "csae x", "cases x", "cacth x", "catc x", "catchs x", "finaly x", "finall x", "finallys x", "brek x", "brea x", "breaks x", "frm x", "fro x", "froms x",
  "immediat x", "imediate x", "intrinsi x", "intrinsc x", "defe x", "dfer x", "defers x", "declar x", "delcare x", "declares x", "asert x", "asser x", "assertss x", "modulee x", "letf x", "ley x", "lett x", "le x", "lt x", "vaar x", "va x", "vr x",
  "é x", "clàss x", "cl" + B + "u0061ss x", "cl" + B + "u0061s x", "İf x", "\u212Aeyof x", "ıf x", "CONSTRUCTOR x", "Constructor x", "constructo x", "construct x",
]);
g("lists that end where a statement can", [
  "{ var }", "{ var a, }", "function f() { var }", "function f() { var a, }", "var /* c */ ;", "var a, /* c */ ;", "var a /* c */ , ;", "var\n;", "var a,\n;", "var a,\n", "var\n", "let a, ;", "const a = 1, ;", "using a = 1, ;",
  "for (var ;;) {}", "for (let ;;) {}", "for (const ;;) {}", "for (var a, ;;) {}", "for (var in x) {}", "for (var a, in x) {}", "for (var a, of x) {}", "for (var a of x) {}", "for (var of of x) {}", "for (let in x) {}", "for (let of x) {}",
  "var =>", "var a, =>", "var }", "var a, }", "namespace N { var }", "namespace N { var a, }", "class C { static { var } }", "if (x) var", "if (x) var ;", "x = () => { var }", "var\nx", "var a\n,b", "var a,\nb\nc", "var a =\n1", "export var ;", "export var a, ;",
  "declare var ;", "declare var a, ;", "declare let ;", "declare const ;", "var ; var ;", "var a, ; var b, ;", "var in", "var of", "var a, in", "var a, of", "let of", "let in", "let a, of",
]);
g("parameters that start with a keyword", [
  "function f(const) {}", "function f(in) {}", "function f(export) {}", "function f(default) {}", "function f(const x) {}", "function f(in x) {}", "function f(export x) {}", "function f(@) {}", "function f(#a) {}", "function f(@d) {}", "function f(@d x) {}",
  "function f(public) {}", "function f(public x) {}", "function f(static x) {}", "function f(abstract x) {}", "function f(async x) {}", "function f(declare x) {}", "function f(readonly x) {}", "function f(override x) {}", "function f(accessor x) {}", "function f(out x) {}",
  "function f(break) {}", "function f(case) {}", "function f(catch) {}", "function f(continue) {}", "function f(debugger) {}", "function f(delete) {}", "function f(do) {}", "function f(else) {}", "function f(enum) {}", "function f(extends) {}", "function f(finally) {}",
  "function f(for) {}", "function f(function) {}", "function f(instanceof) {}", "function f(return) {}", "function f(super) {}", "function f(switch) {}", "function f(throw) {}", "function f(try) {}", "function f(while) {}", "function f(with) {}", "function f(false) {}",
  "function f(typeof) {}", "function f(import) {}", "function f(this) {}", "function f(yield) {}", "function f(await) {}", "function f(let) {}", "function f(static) {}", "function f(implements) {}", "function f(interface) {}", "function f(package) {}",
  "function f(a, ...) {}", "function f(a, ...b, :) {}", "function f(a, ;) {}", "function f(a, /) {}", "function f(a, %) {}", "function f(a, ~) {}", "function f(a, ^) {}", "function f(a, ++) {}", "function f(a, --) {}", "function f(a, ==) {}", "function f(a, &&) {}", "function f(a, ||) {}",
  "function f(a, ??) {}", "function f(a, <<) {}", "function f(a, >>) {}", "function f(a, >) {}", "function f(a, >=) {}", "function f(a, <=) {}", "function f(a, +=) {}", "function f(a, ,) {}", "function f(,) {}", "function f(a,, b) {}",
  "var break", "var case", "var delete", "var false", "var null", "var this", "var typeof", "var import", "var super", "var void", "var yield", "var await", "var let", "let let", "const let = 1", "var static", "var implements", "var @", "var ...", "var ...a",
  "var a, ;x", "var a, ...", "var a, @", "var a, #b", "var a, /", "var a, %", "var a, ~", "var a, ++", "var a, ==", "var a, &&", "var a, ,", "var ,", "var a,, b", "var a, (", "var (", "var a, <T>", "var a, |", "var a, &",
  "var [break] = x", "var [a, ;] = x", "var [a, ...] = x", "var [a, #b] = x", "var [a, @] = x", "var [a, /] = x", "var [#a] = x", "var [a,, b] = x", "var [,] = x", "var [a, (] = x", "var [a, <] = x", "var [a, 1n] = x", "var [a, `b`] = x", "var [a, true] = x",
  "var {#a} = x", "var {a, #b} = x", "var {a, 1} = x", "var {a, 'b'} = x", "var {a, [} = x", "var {a, ;} = x", "var {a, @} = x", "var {a, /} = x", "var {a, (} = x", "var {a, <} = x", "var {a, `b`} = x", "var {a, 1n} = x", "var {a, true} = x", "var {a, ...} = x",
]);
g("members and elements after a name", [
  "class C { static * }", "class C { * }", "class C { async * }", "class C { static async }", "class C { get [ }", "class C { @dec }", "class C { @dec ) }", "class C { @dec @dec2 }", "class C { public }", "class C { public ) }", "class C { x ) }", "class C { x: T ) }",
  "class C { x = 1 ) }", "class C { x ] }", "class C { x = 1 ] }", "class C { x: T ] }", "class C { x: T . }", "class C { x . }", "class C { x = 1 . }", "class C { x: T => }", "class C { x => }", "class C { x: T = 1 => }", "class C { x, }", "class C { x: T, }", "class C { x = 1, }",
  "class C { cosnt x }", "class C { clas x }", "class C { functio x }", "class C { statc x }", "class C { publc x }", "class C { asyn x() {} }", "class C { gett x() {} }", "class C { constructr() bar }", "class C { readonl x }", "class C { abstrac x }", "class C { declar x }",
  "class C { interface x }", "class C { type x }", "class C { module x }", "class C { namespace x }", "class C { is x }", "class C { let x }", "class C { const x }", "class C { var x }", "class C { declare x y }", "class C { declare y }", "class C { type = 1 y }", "class C { interface { }",
  "class C { type 1 }", "class C { namespace 1 }", "class C { 'a' b }", "class C { 1 b }", "class C { [a] b }", "class C { #a b }", "class C { a! b }", "class C { a? b }", "class C { a\nb c }", "class C { a b\nc }", "class C { a /* c */ b }", "class C { /* c */ a b }",
  "x = { a b }", "x = { cosnt b }", "x = { a: 1 b }", "x = { a, b c }", "x = { get a() {} b }", "x = { a() {} b }", "x = { [a]: 1 b }", "x = { ...a b }", "x = { a: 1, ...b c }", "x = { a: 1 }  y", "x = { a: b c }", "x = { a: (b) c }", "x = { a = 1 b }",
  "x = [a b]", "x = [a, b c]", "x = [...a b]", "x = [a = 1 b]", "x = [, a b]", "f(a b)", "f(a, b c)", "f(...a b)", "f(a = 1 b)", "new A(a b)", "f?.(a b)", "f<T>(a b)", "f(a b", "f(a ;", "f(a, b ;", "x = [a ;", "x = [a, b ;", "x = {a: 1 ;", "x = {a ;",
  "function f(a b) {}", "function f(a, b c) {}", "function f(...a b) {}", "function f(a = 1 b) {}", "function f(a: T b) {}", "function f(a? b) {}", "function f(a ;", "function f(a ]", "function f(a, b ]", "function f(a }) {}", "function f(a: T }) {}",
  "var [a b] = x", "var [a, b c] = x", "var [...a b] = x", "var [a = 1 b] = x", "var [a ;", "var [a }", "var {a b} = x", "var {a, b c} = x", "var {a: b c} = x", "var {a = 1 b} = x", "var {...a b} = x", "var {a ;", "var {a ]",
  "enum E { A B }", "enum E { A, B C }", "enum E { A = 1 B }", "enum E { A ;", "enum E { A ]", "enum E { A )", "enum E { 'a' B }", "enum E { A = B C }",
]);
require("node:fs").writeFileSync(__dirname + "/inputs4.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
