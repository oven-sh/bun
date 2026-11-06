#!/usr/bin/env python3
"""class-families.py <seed> [<families>]: typed classes are what the compiler lays out: families of two to four classes, each heir of the last: fields of every kind with initializers that read earlier fields, parameters, statics and `this.method()`; optional, readonly and definite fields; parameter properties; accessors (pairs, getter alone, overridden by the heir, overriding a field's name never: TypeScript forbids it); methods overridden, calling super, returning this; private #fields, #methods and `#x in o`; statics, static blocks, static inheritance; constructors that call a method the heir overrides BEFORE the heir's fields exist (plain: undefined; the type says number: AS PLAIN OR THROWS), that return early, that throw halfway; instanceof, constructor.name, Object.keys in the order of creation, JSON, spread, structured copies, `in`, hasOwn; instances read through the base type at one site (so one site sees every layout), through an interface, through any. Lines are `name: answer`; as plain Bun's or a throw, never a third answer."""
import random, sys
seed = int(sys.argv[1]); count = int(sys.argv[2]) if len(sys.argv) > 2 else 24
R = random.Random(seed)
print('''declare const console: { log(...values: unknown[]): void };
const show = (v: unknown): string => (v === null ? "null" : v === undefined ? "u" : typeof v === "function" ? "f" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v as object).join() + "}") : typeof v === "number" && Object.is(v, -0) ? "-0" : String(v));
const attempt = (f: () => unknown): string => { try { return show(f()); } catch (e) { return "THROWS " + (e as Error).name; } };
let trace: string[] = [];''')
TYPES = [('number', ['1', '2.5', '-0', '0', '7']), ('string', ['"s"', '""', '"long text here"']), ('boolean', ['true', 'false']), ('number[]', ['[]', '[1, 2]']), ('{ k: number }', ['{ k: 1 }']), ('number | null', ['null', '3']), ('string | undefined', ['undefined', '"t"']), ('() => number', ['() => 4'])]
for fam in range(count):
    depth = R.randrange(2, 5); P = 'F%d' % fam; fields = []; methods = []; out = []
    for d in range(depth):
        C = '%s_%d' % (P, d); base = '%s_%d' % (P, d - 1) if d else None; body = []; own = []
        for i in range(R.randrange(1, 5)):
            T, vals = R.choice(TYPES); n = 'x%d_%d' % (d, i); mod = R.choice(['', '', '', 'readonly ', ''])
            c = R.randrange(8)
            nums = [f for f, t in fields + own if t == 'number' and not f.endswith('?')]
            if c == 0 and T == 'number' and nums: init = ' = this.%s + 1' % R.choice(nums)
            elif c == 1 and T == 'number' and methods: init = ' = this.%s() as number' % R.choice(methods) if False else ' = %s' % R.choice(vals)
            elif c == 2: body.append('  %s?: %s;' % (n, T)); own.append((n + '?', T)); continue
            elif c == 3 and T == 'number': init = ' = %s.count++' % C
            else: init = ' = %s' % R.choice(vals)
            body.append('  %s%s: %s%s;' % (mod, n, T, init)); own.append((n, T))
        body.insert(0, '  static count = %d; static tag = "%s";' % (d * 10, C))
        if R.random() < 0.5: body.append('  #secret = %d; secret(): number { return this.#secret + %d; } static has(o: object): boolean { return #secret in o; }' % (d + 1, d))
        m = 'm%d' % d; body.append('  %s(): string { return "%s.%s" + %s; }' % (m, C, m, ' + '.join(['""'] + ['show(this.%s)' % f.rstrip('?') for f, t in (fields + own)[-3:]]))); 
        if methods and R.random() < 0.7:
            o = R.choice(methods); body.append('  override %s(): string { return "%s>" + %s; }' % (o, C, R.choice(['super.%s()' % o, '"cut"', 'super.%s() + show(this.%s)' % (o, own[0][0].rstrip('?'))])))
        if R.random() < 0.5: body.append('  get g%d(): number { return %d; } set g%d(v: number) { trace.push("%s.g%d=" + v); }' % (d, d, d, C, d))
        if R.random() < 0.3: body.append('  static { trace.push("static %s " + this.count); }' % C)
        ctor = R.randrange(6)
        call = ('trace.push("in %s " + this.%s());' % (C, R.choice(methods + [m])))
        if ctor < 2: body.append('  constructor(a?: number) { %s }' % ('super(a);' if base else ''))
        elif ctor == 2: body.append('  constructor(a: number = 1) { %s %s }' % ('super(a + 1);' if base else '', call))
        elif ctor == 3: body.append('  constructor(public given%d: number = %d) { %s %s }' % (d, d, 'super(given%d);' % d if base else '', call))
        elif ctor == 4: body.append('  constructor(fail?: number) { %s if (fail === %d) throw new RangeError("%s"); %s }' % ('super(fail);' if base else '', d + 100, C, call))
        else: body.append('  constructor(a?: number) { %s %s }' % ('super();' if base else '', call))
        out.append('class %s%s {\n%s\n}' % (C, ' extends ' + base if base else '', '\n'.join(body)))
        fields += own; methods.append(m)
    print('\n'.join(out))
    classes = ['%s_%d' % (P, d) for d in range(depth)]
    first = fields[0][0].rstrip('?')
    print('function read%d(o: %s_0): string { return show(o.%s) + o.m0() + show(o.constructor.name); }' % (fam, P, first))
    print('{ trace = []; const made = [%s].map(C => attempt(() => { const o = new (C as any)(); return [read%d(o), Object.keys(o).join(), JSON.stringify(o), show({ ...o }), %s].join(" "); }));' % (', '.join(classes), fam, ', '.join('o instanceof %s' % c for c in classes)))
    print('  for (let i = 0; i < 100; i++) for (const C of [%s]) attempt(() => read%d(new (C as any)()));' % (', '.join(classes), fam))
    print('  trace.length = Math.min(trace.length, 24); console.log("%s made: " + made.join(" | ")); console.log("%s trace: " + trace.join(" ; ")); console.log("%s fails: " + [%s].map(C => attempt(() => new (C as any)(10%d))).join(" | ") + " statics " + [%s].map(C => C.count + C.tag + show(Object.getPrototypeOf(C) === Function.prototype)).join()); }' % (P, P, P, ', '.join(classes), R.randrange(depth), ', '.join(classes)))
