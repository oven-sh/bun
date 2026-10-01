// Helpers shared by the input files. A case is { fam, src, form?, ctx?, note? }.
// `fam` names the production family. Each input file maps its families to the Bun site
// (file:line in the worktree) and to the production of the reference parser (parser.go:line).

// Where a type can stand. The key is recorded as `ctx`.
export const TYPE_CONTEXTS = {
  alias: T => `type X = ${T};`,
  var: T => `let x: ${T};`,
  param: T => `function f(a: ${T}) {}`,
  ret: T => `function f(): ${T} { throw 0 }`,
  arrowParam: T => `const f = (a: ${T}) => 0;`,
  arrowRet: T => `const f = (a): ${T} => 0;`,
  as: T => `const v = x as ${T};`,
  satisfies: T => `const v = x satisfies ${T};`,
  cast: T => `const v = <${T}>x;`,
  callArg: T => `f<${T}>(x);`,
  newArg: T => `new F<${T}>(x);`,
  tagArg: T => `f<${T}>\`x\`;`,
  inst: T => `const v = f<${T}>;`,
  field: T => `class C { p: ${T}; }`,
  method: T => `class C { m(a: ${T}): ${T} { throw 0 } }`,
  typeArg: T => `let x: A<${T}>;`,
  fnTypeParam: T => `let x: (a: ${T}) => void;`,
  fnTypeRet: T => `let x: () => ${T};`,
  tupleEl: T => `let x: [${T}];`,
  tupleNamed: T => `let x: [a: ${T}];`,
  member: T => `let x: { a: ${T} };`,
  indexSig: T => `let x: { [k: string]: ${T} };`,
  mapped: T => `let x: { [K in ${T}]: ${T} };`,
  unionRight: T => `let x: A | ${T};`,
  unionLeft: T => `let x: ${T} | A;`,
  keyofArg: T => `let x: keyof ${T};`,
  arrayOf: T => `let x: ${T}[];`,
  condCheck: T => `type X = ${T} extends A ? 1 : 2;`,
  condExtends: T => `type X = A extends ${T} ? 1 : 2;`,
  condTrue: T => `type X = A extends B ? ${T} : 2;`,
  condFalse: T => `type X = A extends B ? 1 : ${T};`,
  constraint: T => `function f<U extends ${T}>() {}`,
  tpDefault: T => `type X<U = ${T}> = U;`,
  catch: T => `try {} catch (e: ${T}) {}`,
  thisParam: T => `function f(this: ${T}) {}`,
  ifaceExtends: T => `interface I extends ${T} {}`,
  classImplements: T => `class C implements ${T} {}`,
  classExtendsArg: T => `class C extends B<${T}> {}`,
  jsxArg: T => `const v = <C<${T}> />;`,
  template: T => `type X = \`a\${${T}}b\`;`,
  paren: T => `let x: (${T});`,
  objMethodRet: T => `const o = { m(): ${T} { throw 0 } };`,
  getterRet: T => `class C { get p(): ${T} { throw 0 } }`,
  declareFn: T => `declare function f(a: ${T}): ${T};`,
  ctorParamProp: T => `class C { constructor(public a: ${T}) {} }`,
  forOf: T => `for (const a: ${T} of b) {}`,
};

// Contexts every form goes through.
export const PRIMARY = [
  "alias",
  "var",
  "param",
  "ret",
  "arrowParam",
  "arrowRet",
  "as",
  "callArg",
  "field",
  "typeArg",
  "fnTypeParam",
  "tupleEl",
  "member",
];

export const ALL_CONTEXTS = Object.keys(TYPE_CONTEXTS);

export function cross(fam, forms, contexts = PRIMARY) {
  const out = [];
  for (const form of forms) {
    for (const ctx of contexts) {
      out.push({ fam, form, ctx, src: TYPE_CONTEXTS[ctx](form) });
    }
  }
  return out;
}

export function list(fam, sources) {
  return sources.map(src => ({ fam, src }));
}

export function template(fam, forms, make, ctx) {
  return forms.map(form => ({ fam, form, ctx, src: make(form) }));
}
