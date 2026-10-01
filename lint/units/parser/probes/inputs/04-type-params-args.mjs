// Group 04: type parameter lists and type argument lists.
import { list, template } from "./_lib.mjs";

const G = "src/js_parser/parse/parse_skip_typescript.rs";
const R = "parser.go";

export const families = {
  tparams: {
    bun: `${G}:933-1083 skip_type_script_type_parameters (flags per owner: parse_fn.rs:68 and :457 ALLOW_CONST_MODIFIER; parse/mod.rs:731 and parse_prefix.rs:576,:639 class: IN_OUT | CONST; ${G}:1129 and :1151 alias and interface: IN_OUT | EMPTY; parse_property.rs:626 member: CONST; ${G}:370,:377,:886 types: CONST); the error at ${G}:1038-1047 goes to the log directly and survives a backtrack`,
    ref: `${R}:3270 parseTypeParameters, 3277 parseTypeParameter, 3908 parseModifiersEx(permitConstAsModifier)`,
  },
  tparamsArrow: {
    bun: `src/js_parser/parse/parse_prefix.rs:892-990 pfx_t_less_than (931-945 tsx: typescript.rs:44 is_ts_arrow_fn_jsx; 960-986 ts: try_skip_type_script_type_parameters_then_open_paren_with_backtracking, then "<T>x"), parse/mod.rs:1704 async arrow`,
    ref: `${R}:4244 isParenthesizedArrowFunctionExpression, 4261 nextIsParenthesizedArrowFunctionExpression, 4390 parseParenthesizedArrowFunctionExpression, 5185 parseTypeAssertion`,
  },
  targsExpr: {
    bun: `src/js_parser/parse/parse_suffix.rs:871-903 and :962-994 (try_skip_type_script_type_arguments_with_backtracking, ${G}:1331-1342, typescript.rs:10 can_follow_type_arguments_in_expression), parse_suffix.rs:187-194 (after "?."), parse_prefix.rs:692-697 (new)`,
    ref: `${R}:5295 tryParseTypeArgumentsInExpression, 5323 canFollowTypeArgumentsInExpression, 5395 parseMemberExpressionRest, 5501 parseCallExpressionRest`,
  },
  targsType: { bun: `${G}:1183-1230 skip_type_script_type_arguments, lexer expect_greater_than splits ">>", ">=", ">>="`, ref: `${R}:3056 parseTypeArgumentsOfTypeReference, 3063 parseTypeArguments, 3041 reScanGreaterThanToken` },
  targsHeritage: { bun: `src/js_parser/parse/mod.rs:147-160 (class extends: expression at Level::New, then type arguments), 163-174 (implements: arbitrary types), ${G}:1156-1177 (interface)`, ref: `${R}:1824 parseHeritageClauses, 1884 parseExpressionWithTypeArguments` },
  targsJsx: { bun: `src/js_parser/parse/parse_jsx.rs:28 skip_type_script_type_arguments::<true, false>`, ref: `${R}:4981 parseJsxOpeningOrSelfClosingElementOrOpeningFragment` },
};

const tparams = [
  "<T>", "<T, U>", "<T, U, V>", "<T extends A>", "<T = A>", "<T extends A = B>", "<T extends A, U extends B = C>", "<T,>", "<T, U,>", "<>", "<,>", "<T,,U>", "<,T>", "<T U>", "<T;U>",
  "<in T>", "<out T>", "<in out T>", "<const T>", "<const in T>", "<in const T>", "<const out T>", "<out const T>", "<const in out T>", "<in out const T>", "<out in T>", "<in in T>", "<out out T>", "<const const T>", "<in T, out U>", "<in out T, const U>",
  "<out>", "<in>", "<const>", "<in out>", "<out out>", "<out in>", "<in in>", "<out, in>", "<out = A>", "<out extends A>", "<out out = A>", "<out out extends A>", "<out out, T>", "<in out out>", "<const out>", "<const in>",
  "<T extends>", "<T =>", "<T extends = A>", "<T = A extends B>", "<T extends A extends B>", "<T = A = B>", "<T extends A = B = C>", "<T extends A ? B : C>", "<T extends A extends B ? C : D>", "<T = A extends B ? C : D>", "<T extends keyof U>", "<T extends typeof a>", "<T extends () => void>", "<T extends new () => A>", "<T extends { a: A }>", "<T extends [A, B]>", "<T extends A[]>", "<T extends A | B>", "<T extends A & B = A>", "<T extends \"a\" | \"b\">", "<T extends 1>", "<T extends -1>", "<T extends `a${string}`>", "<T extends infer U>", "<T extends a is B>", "<T = () => void>", "<T = A<B>>", "<T = A<B<C>>>", "<T extends A<B>>", "<T extends A<B<C>>>", "<T extends A<B> = C<D>>", "<T extends A<B>, U = C<D>>",
  "<public T>", "<private T>", "<protected T>", "<readonly T>", "<static T>", "<abstract T>", "<declare T>", "<override T>", "<accessor T>", "<async T>", "<export T>", "<default T>", "<public in T>", "<in public T>", "<@d T>",
  "<T?>", "<T!>", "<T: A>", "<T extends A?>", "<...T>", "<T[]>", "<T.U>", "<T<U>>", "<\"T\">", "<1>", "<T extends 1 + 1>", "<T extends a.b>", "<T extends a.b.c<D>>", "<T extends (A)>", "<T extends !A>", "<T extends a()>", "<T extends new A>", "<T extends this>", "<T extends void>", "<T extends null>", "<T extends undefined>", "<T extends never = never>",
  "<as>", "<type>", "<of>", "<async>", "<await>", "<yield>", "<infer>", "<keyof>", "<readonly>", "<unique>", "<abstract>", "<asserts>", "<is>", "<let>", "<static>", "<any>", "<string>", "<number>", "<void>", "<null>", "<this>", "<if>", "<class>", "<new>", "<typeof>", "<undefined>", "<symbol>", "<object>", "<never>", "<unknown>", "<declare>", "<module>", "<namespace>", "<global>", "<get>", "<set>", "<satisfies>", "<accessor>", "<override>", "<public>", "<implements>", "<interface>", "<package>", "<enum>", "<arguments>", "<eval>", "<intrinsic>",
  "<\nT\n>", "<T\n,\nU>", "<T\nextends A>", "<T extends\nA>", "<T =\nA>", "<in\nT>", "<out\nT>", "<const\nT>", "<T", "T>", "<T>>", "<<T>>", "< T >", "<T extends A, >", "<T extends A,\n>",
];

const tparamOwners = {
  fnDecl: P => `function f${P}() {}`,
  fnExpr: P => `const f = function ${P}() {};`,
  namedFnExpr: P => `const f = function g${P}() {};`,
  asyncFn: P => `async function f${P}() {}`,
  generator: P => `function* f${P}() {}`,
  declareFn: P => `declare function f${P}(): void;`,
  classDecl: P => `class C${P} {}`,
  classExpr: P => `const c = class ${P} {};`,
  namedClassExpr: P => `const c = class D${P} {};`,
  abstractClass: P => `abstract class C${P} {}`,
  declareClass: P => `declare class C${P} {}`,
  classExtends: P => `class C${P} extends B {}`,
  iface: P => `interface I${P} {}`,
  alias: P => `type X${P} = 1;`,
  method: P => `class C { m${P}() {} }`,
  staticMethod: P => `class C { static m${P}() {} }`,
  optionalMethod: P => `class C { m?${P}() {} }`,
  getter: P => `class C { get p${P}() { return 1 } }`,
  setter: P => `class C { set p${P}(v) {} }`,
  ctor: P => `class C { constructor${P}() {} }`,
  objMethod: P => `const o = { m${P}() {} };`,
  objGetter: P => `const o = { get p${P}() { return 1 } };`,
  callSig: P => `type X = { ${P}(): void };`,
  constructSig: P => `type X = { new ${P}(): A };`,
  methodSig: P => `type X = { m${P}(): void };`,
  fnType: P => `let x: ${P}() => void;`,
  ctorType: P => `let x: new ${P}() => A;`,
  abstractCtorType: P => `let x: abstract new ${P}() => A;`,
  arrow: P => `const f = ${P}() => 0;`,
  arrowParam: P => `const f = ${P}(a: T) => a;`,
  arrowRet: P => `const f = ${P}(a): T => a;`,
  asyncArrow: P => `const f = async ${P}() => 0;`,
  arrowStmt: P => `${P}() => 0;`,
  cast: P => `const v = ${P}x;`,
  castParen: P => `const v = ${P}(x);`,
  enumDecl: P => `enum E${P} {}`,
  namespaceDecl: P => `namespace N${P} {}`,
  field: P => `class C { p${P}: A; }`,
  varDecl: P => `let x${P} = 1;`,
};

const targs = [
  "<A>", "<A, B>", "<A, B, C>", "<A,>", "<>", "<,>", "<A,,B>", "<,A>", "<A B>", "<A | B>", "<A | >", "<| A>", "<A & >", "<A extends B ? C : D>", "<() => void>", "<(a: A) => B>", "<new () => A>", "<{ a: A }>", "<[A, B]>", "<A[]>", "<A<B>>", "<A<B<C>>>", "<A<B<C<D>>>>", "<typeof a>", "<keyof A>", "<\"a\">", "<1>", "<-1>", "<`a${B}`>", "<any>", "<void>", "<null>", "<this>", "<unique symbol>", "<readonly A[]>", "<infer U>", "<a is B>", "<asserts a>", "<import(\"x\")>", "<A.B.C>", "<A!>", "<?A>", "<A?>", "<*>", "<if>", "<const>", "<in A>", "<out A>", "<const A>", "<A = B>", "<A extends B>", "<...A>", "<a: A>", "<\nA\n>", "<A,\nB>", "<A", "< A >", "<(A)>", "<(a = 1) => void>", "<({ a = 1 }) => void>", "<(a: ) => void>", "<A | () => void>", "<keyof () => void>",
];

const targExprOwners = {
  call: A => `f${A}(x);`,
  callNoArgs: A => `f${A}();`,
  memberCall: A => `a.b${A}(x);`,
  optionalCall: A => `a?.b${A}(x);`,
  optionalCall2: A => `f${A}?.(x);`,
  optionalCall3: A => `a?.${A}(x);`,
  newCall: A => `new F${A}(x);`,
  newNoArgs: A => `new F${A};`,
  newMember: A => `new a.b${A}(x);`,
  tagged: A => `f${A}\`x\`;`,
  taggedSubst: A => `f${A}\`x\${y}\`;`,
  inst: A => `const v = f${A};`,
  instStmt: A => `f${A};`,
  instNewline: A => `const v = f${A}\ng();`,
  instMember: A => `const v = f${A}.x;`,
  instOptional: A => `const v = f${A}?.x;`,
  instIndex: A => `const v = f${A}[0];`,
  instTwice: A => `const v = f${A}${A};`,
  instAs: A => `const v = f${A} as any;`,
  instSatisfies: A => `const v = f${A} satisfies any;`,
  instNonNull: A => `const v = f${A}!;`,
  instComma: A => `const v = [f${A}, g${A}];`,
  instObj: A => `const v = { a: f${A} };`,
  instTernary: A => `const v = f${A} ? 1 : 2;`,
  instOr: A => `const v = f${A} || g;`,
  instEq: A => `const v = f${A} === g;`,
  instAssign: A => `f${A} = 1;`,
  instPlus: A => `const v = f${A} + 1;`,
  instMinus: A => `const v = f${A} - 1;`,
  instIdent: A => `const v = f${A} g;`,
  instNumber: A => `const v = f${A} 1;`,
  instString: A => `const v = f${A} "s";`,
  instParenOnNextLine: A => `const v = f${A}\n(x);`,
  instTypeof: A => `const v = typeof f${A};`,
  instIn: A => `const v = f${A} in g;`,
  instInstanceof: A => `const v = f${A} instanceof g;`,
  instReturn: A => `function h() { return f${A} }`,
  instArrowBody: A => `const v = () => f${A};`,
  instSpread: A => `const v = [...f${A}];`,
  instTemplateNext: A => `const v = f${A}\n\`x\`;`,
  instClassExtends: A => `class C extends f${A} {}`,
  instClassExtendsCall: A => `class C extends f${A}(x) {}`,
  instExportDefault: A => `export default f${A};`,
  instArg: A => `g(f${A}, h${A});`,
  instThis: A => `this${A}(x);`,
  instSuper: A => `class C extends B { constructor() { super${A}(x) } }`,
  instImport: A => `import${A}("x");`,
  instImportMeta: A => `import.meta${A};`,
  instParen: A => `(f)${A}(x);`,
  instNumberLit: A => `1${A}(x);`,
  instStringLit: A => `"s"${A}(x);`,
  instArrayLit: A => `[]${A}(x);`,
  instObjLit: A => `({})${A}(x);`,
  instFnExpr: A => `(function () {})${A}(x);`,
  instNewTarget: A => `function h() { new.target${A}(x) }`,
  instAsync: A => `async${A}(x);`,
  instAsyncArrow: A => `async${A}(x) => 0;`,
  instAwait: A => `async function h() { await f${A}(x) }`,
  instYield: A => `function* h() { yield f${A}(x) }`,
  instDecorator: A => `@f${A}(x) class C {}`,
  instDecoratorNoCall: A => `@f${A} class C {}`,
};

const relational = [
  "a < b > c", "a < b > (c)", "a < b >> c", "a < b >>> c", "a < b >= c", "a < b >>= c", "a < b > = c", "a<b>>c", "a<b>>>c", "a<b>=c", "a<b>>=c", "a<b>>>=c", "a<b<c>>d", "a<b<c>>(d)", "a<b<c>>>(d)", "a<b<c<d>>>(e)", "a<b<c<d>>> (e)", "a<b<c>> = d", "a<b>(c)<d>(e)", "a<b>(c)<d>e", "a < b, c > (d)", "f(a < b, c > (d))", "f(a < b, c > d)", "[a < b, c > (d)]", "a < b && c > (d)", "a < b || c > (d)", "a < (b) > (c)", "a < b > -c", "a < b > +c", "a < b > !c", "a < b > ~c", "a < b > typeof c", "a < b > c.d", "a<b>\nc", "a<b>\n(c)", "a\n<b>(c)", "a<\nb>(c)", "a<b\n>(c)", "a << b > (c)", "a <<b>(c) => d", "a<<T>(x: T) => T>(y)", "a<<T>() => void>()", "f<<T>(a: T) => T>`x`", "a <= b > (c)", "a <<= b > (c)", "a<b>>()", "a<b<c>>>()", "a<b>>>()", "a<b, c>>()", "a<b>=>c", "a<b> => c", "a<b>(c) => d", "a<b>c => d", "async<b>(c) => d", "async <b>(c) => d", "async\n<b>(c) => d", "async<b>\n(c) => d", "x = a<b>(c)", "x = a<b>>(c)", "let x: A<B>= y", "let x: A<B<C>>= y", "let x: A<B<C<D>>>= y", "let x: A<B>=y", "let x: A<B<C>>=y", "let x: A<B> = y", "let x: A<B>>= y", "let x = y as A<B>> c", "let x = y as A<B>>= c", "let x = y as A<B> > c", "let x = <A<B>>y", "let x = <A<B<C>>>y", "let x = <A<B>>>y", "type X = A<B<C>>>", "type X = A<B>>", "function f(a: A<B>= c) {}", "function f(a: A<B<C>>= d) {}", "function f(a: A<B<C<D>>>= e) {}", "class C { p: A<B>= c }", "class C { p: A<B<C>>= d }", "const f = (a: A<B>= c) => 0", "const f = (a: A<B<C>>= d) => 0", "const f = (): A<B>=> 0", "const f = (): A<B<C>>=> 0", "const f = (): A<B> => 0", "type X<T = A<B>>= T", "type X<T extends A<B>>= T", "type X<T = A<B<C>>>= T", "function f<T = A<B>>() {}", "function f<T extends A<B<C>>>() {}", "class C<T = A<B>>{}", "class C<T = A<B>>extends D {}", "class C extends D<A<B>>{}", "class C extends D<A<B<C>>>{}", "interface I<T = A<B>>{}", "interface I extends D<A<B>>{}", "const v = <C<A<B>>/>", "const v = <C<A<B>>></C>", "f<A<B>>>(x)", "f<A<B>>>>(x)", "new F<A<B>>", "new F<A<B>>()", "new F<A<B>>>()", "f<A<B>>`x`", "f<A<B>>\n`x`", "f?.<A<B>>(x)", "a?.b<A<B>>(x)",
];

const heritage = [
  "class C extends B<A> {}", "class C extends B<A, D> {}", "class C extends B<A<D>> {}", "class C extends B<> {}", "class C extends B<A,> {}", "class C extends b.c<A> {}", "class C extends b.c.d<A<E>> {}", "class C extends B<A>.D {}", "class C extends B<A>() {}", "class C extends B<A>(x) {}", "class C extends (B)<A> {}", "class C extends (B<A>) {}", "class C extends b()<A> {}", "class C extends b[0]<A> {}", "class C extends B<A>[0] {}", "class C extends B<A><D> {}", "class C extends B!<A> {}", "class C extends B<A>! {}", "class C extends B\n<A> {}", "class C extends B<A>\n{}", "class C extends B<A {}", "class C extends B A> {}", "class C extends B<A> implements D<E> {}", "class C extends B<A> implements D<E>, F<G<H>> {}", "class C implements D<E> {}", "class C implements D<E>, F {}", "class C implements d.e.f<G> {}", "class C implements D<> {}", "class C implements D<E,> {}", "class C implements {}", "class C implements D, {}", "class C implements D E {}", "class C implements D implements E {}", "class C implements D extends B {}", "class C extends B extends D {}", "class C extends B, D {}", "class C extends {}", "class C extends B<A> extends D {}",
  "class C implements string[] {}", "class C implements () => void {}", "class C implements typeof x {}", "class C implements { a: 1 } {}", "class C implements A | B {}", "class C implements A & B {}", "class C implements (A) {}", "class C implements keyof A {}", "class C implements \"a\" {}", "class C implements 1 {}", "class C implements null {}", "class C implements void {}", "class C implements this {}", "class C implements [A] {}", "class C implements import(\"x\") {}", "class C implements import(\"x\").A {}", "class C implements A extends B ? D : E {}", "class C implements A[B] {}", "class C implements A! {}", "class C implements a() {}", "class C implements a.b() {}", "class C implements a[\"b\"] {}", "class C implements a?.b {}", "class C implements new A {}", "class C implements A<B>.D {}", "class C implements if {}", "class C implements A.if {}", "class C implements A.#b {}", "class C implements `a` {}", "class C implements unique symbol {}", "class C implements readonly A[] {}", "class C implements abstract new () => A {}", "class C implements a is B {}", "class C implements A\n{}", "class C\nimplements A {}", "class C implements\nA {}", "class C implements A,\nB {}",
  "const c = class extends B<A> {};", "const c = class D extends B<A> implements E<F> {};", "const c = class implements E<F> {};", "const c = class implements {};", "class implements {}", "class C<T> extends B<T> implements D<T> {}", "abstract class C<T> extends B<T> implements D<T> {}", "declare class C<T> extends B<T> implements D<T> {}", "export default class<T> extends B<T> implements D<T> {}", "export default class extends B<A> {}", "class implements implements I {}", "class C extends implements {}", "class C extends implements implements I {}", "class C extends B implements implements {}", "class C extends (B as any) {}", "class C extends (B as any)<A> {}", "class C extends B as any {}", "class C extends (<any>B) {}", "class C extends <any>B {}", "class C extends B satisfies any {}", "class C extends f<A>()<B> {}", "class C extends f<A>`x` {}", "class C extends new B<A>() {}", "class C extends class<T> {}<A> {}", "class C extends function<T>() {} {}", "class C extends a ? b : c {}", "class C extends a || b {}", "class C extends await b {}", "class C extends yield {}", "class C extends typeof b {}", "class C extends void 0 {}", "class C extends null {}", "class C extends {} {}", "class C extends [] {}", "class C extends 1 {}", "class C extends \"a\" {}", "class C extends `a` {}", "class C extends this {}", "class C extends super.a {}", "class C extends import(\"x\") {}", "class C extends async () => {} {}", "class C extends a.b?.c {}", "class C extends a?.b<A> {}",
];

const jsx = [
  "const v = <C<A> />;", "const v = <C<A>></C>;", "const v = <C<A, B> />;", "const v = <C<A<B>> />;", "const v = <C<A<B>>></C>;", "const v = <C<A<B<D>>> />;", "const v = <C<> />;", "const v = <C<A,> />;", "const v = <C<A | B> a=\"b\" />;", "const v = <C<A> a={1} {...b} />;", "const v = <a.b<A> />;", "const v = <a.b.c<A>></a.b.c>;", "const v = <a:b<A> />;", "const v = <a-b<A> />;", "const v = <div<A> />;", "const v = <C <A> />;", "const v = <C\n<A> />;", "const v = <C<A>\n/>;", "const v = <C<\nA\n> />;", "const v = <C<A></C<A>>;", "const v = <C<A>></C<A>>;", "const v = <<A> />;", "const v = <><C<A> /></>;", "const v = <C<() => void> />;", "const v = <C<(a: A) => B> />;", "const v = <C<{ a: A }> />;", "const v = <C<[A, B]> />;", "const v = <C<typeof a> />;", "const v = <C<\"a\"> />;", "const v = <C<A extends B ? D : E> />;", "const v = <C<A | > />;", "const v = <C<A a=\"b\" />;", "const v = <C<A>>;", "const v = <C<A>>>text</C>;", "const v = <C<A>>{x}</C>;", "const v = <C<A>>></C>;", "const v = <C<A>=\"b\" />;", "const v = <C<A>a=\"b\" />;", "const v = <C<A>/>;",
  "const f = <T,>(a: T) => a;", "const f = <T>(a: T) => a;", "const f = <T extends unknown>(a: T) => a;", "const f = <T extends {}>(a: T) => a;", "const f = <T, U>(a: T, b: U) => a;", "const f = <T = any>(a: T) => a;", "const f = <const T,>(a: T) => a;", "const f = <const T>(a: T) => a;", "const f = <const T extends A>(a: T) => a;", "const f = <in T,>(a: T) => a;", "const f = <out T,>(a: T) => a;", "const f = <T extends>(a: T) => a;", "const f = <T extends=\"a\">(a: T) => a</T>;", "const f = <T extends={1}>x</T>;", "const f = <T extends />;", "const f = <T extends A>() => 0;", "const f = <T extends A,>() => 0;", "const f = <T extends A = B>() => 0;", "const f = <T extends\nA>() => 0;", "const f = <T\nextends A>() => 0;", "const f = <T\n,>() => 0;", "const f = async <T,>(a: T) => a;", "const f = async <T>(a: T) => a;", "const f = async <T extends A>(a: T) => a;", "const f = <T,>(a: T): T => a;", "const f = <T,>(a) => <div>{a}</div>;", "const f = <T,>() => <C<T> />;", "const f = <T extends keyof U, U>(a: T) => a;", "const f = <T extends () => void>(a: T) => a;", "const f = <T extends A<B>>(a: T) => a;", "const f = <T extends A<B<C>>>(a: T) => a;", "const f = <T,>\n(a: T) => a;", "const f = <T,>(a: T)\n=> a;", "const v = <T>x;", "const v = <T>(x);", "const v = <T,>x;", "const v = <any>x;", "const v = <const>x;", "const v = <const>[1];", "const v = <T extends A>x;", "const v = <T = A>x;", "const v = <[]>(x);", "const v = <A[]>(x);", "const v = <T,>;", "const v = <T extends A>text</T>;",
];

const cases = [];
for (const [ctx, make] of Object.entries(tparamOwners)) {
  const fam = ["arrow", "arrowParam", "arrowRet", "asyncArrow", "arrowStmt", "cast", "castParen"].includes(ctx) ? "tparamsArrow" : "tparams";
  cases.push(...template(fam, tparams, make, ctx));
}
for (const [ctx, make] of Object.entries(targExprOwners)) cases.push(...template("targsExpr", targs, make, ctx));
cases.push(...list("targsType", relational));
cases.push(...list("targsHeritage", heritage));
cases.push(...list("targsJsx", jsx));

export default { name: "type parameters and type arguments", families, cases, programs: ["ts", "tsx"], emit: true };
