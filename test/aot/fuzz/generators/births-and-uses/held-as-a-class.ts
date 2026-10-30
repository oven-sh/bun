// Objects that `new C` did not make, held as the class C: every birth, every way of holding it, every read, and every declared position for what was read. TypeScript lets each of them
// through behind a cast, and a value that arrives from JSON.parse, Object.create or a proxy is held so in ordinary programs. What the compiler believes of a C may not decide what such a program does.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const classes: Record<string, string> = {
    empty: 'class C {}',
    fields: 'class C { code = 1; label = "x"; flag = true; inner = { deep: 2 }; list = [1, 2]; twice() { return this.code * 2; } get got() { return this.code; } }',
  };
  const births: Record<string, string> = {
    createPrototype: 'Object.create(C.prototype)',
    createClass: 'Object.create(C)',
    createNull: 'Object.create(null)',
    literal: '{}',
    literalProto: '{ __proto__: C.prototype }',
    parsed: 'JSON.parse("{}")',
    parsedWith: 'JSON.parse(`{"code":"text","extra":5}`)',
    assigned: 'Object.assign(Object.create(C.prototype), { extra: 5 })',
    cloned: 'structuredClone(new C())',
    setPrototype: 'Object.setPrototypeOf({ extra: 5 }, C.prototype)',
    constructed: 'Reflect.construct(Object, [], C)',
    spread: '{ ...new C() }',
    below: 'new (class extends C { extra = 5; })()',
    proxied: 'new Proxy(new C(), {})',
    honest: 'new C()',
    honestChanged: '(() => { const o: any = new C(); o.extra = 5; delete o.code; return o; })()',
    array: '[]', func: '(() => {})', nothing: 'undefined', nul: 'null', number: '7',
  };
  const holds: Record<string, (birth: string) => string> = {
    declared: b => `const held: C = ${b} as any;`,
    cast: b => `const held = (${b}) as any as C;`,
    maker: b => `function make(): C { return ${b} as any; }\nconst held = make();`,
    parameter: b => `let held!: C; function take(c: C) { held = c; } take(${b} as any);`,
    element: b => `const all: C[] = [${b} as any]; const held = all[0];`,
    member: b => `class Box { constructor(public it: C) {} } const held = new Box(${b} as any).it;`,
  };
  const reads: Record<string, string> = {
    undeclared: '(held as any).extra', missing: '(held as any).nowhere', declaredField: '(held as any).code', byKey: '(held as any)["ex" + "tra"]',
    method: '(held as any).twice?.()', getter: '(held as any).got', deep: '(held as any).inner?.deep', isIn: '("extra" in (held as any))', instance: '(held instanceof C)', keys: 'Object.keys(held as any).length',
  };
  const typedReads: Record<string, string> = { fieldTyped: 'held.code', labelTyped: 'held.label', methodTyped: 'held.twice()', getterTyped: 'held.got', deepTyped: 'held.inner.deep', listTyped: 'held.list.length' };
  const positions: Record<string, (read: string) => string> = {
    functionNumber: r => `function run(): number { return ${r} as any; }\nshow(() => run());`,
    arrowString: r => `const run = (): string => ${r} as any;\nshow(() => run());`,
    callbackNumber: r => `function attempt(f: () => number): number { return f(); }\nshow(() => attempt(() => ${r} as any));`,
    variableBoolean: r => `show(() => { const v: boolean = ${r} as any; return v; });`,
    parameterNumber: r => `let sum = 0; function note(v: number) { sum = Math.imul(sum, 31) + v | 0; }\nshow(() => { note(${r} as any); return sum; });`,
    objectResult: r => `function run(): { deep: number } { return ${r} as any; }\nshow(() => run()?.deep);`,
    untyped: r => `show(() => ${r});`,
  };
  const head = 'function show(f: () => unknown) { try { const v = f(); console.log(typeof v, typeof v === "object" || typeof v === "function" ? String(v === null ? null : Object.keys(v as object)) : String(v)); } catch (e) { console.log("threw", (e as Error)?.constructor?.name); } }\n';
  for (const [c, declaration] of Object.entries(classes))
    for (const [b, birth] of Object.entries(births))
      for (const [h, hold] of Object.entries(holds))
        for (const [p, position] of Object.entries(positions))
          // One read a program: a program that dies says which read it was.
          for (const [r, read] of Object.entries(c === "fields" ? { ...reads, ...typedReads } : reads))
            made.push({ name: `${c}-${b}-${h}-${p}-${r}`, file: "program.ts", text: `${head}${declaration}\n${hold(birth)}\n${position(read)}\n` });
  return made;
}
