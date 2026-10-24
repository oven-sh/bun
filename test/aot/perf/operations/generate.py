#!/usr/bin/env python3
"""generate.py <folder> [row,row,.. to leave out of the TypeScript]: writes alone/<row>.ts and opened/<row>.ts (what ../operations.test.ts builds and counts: it runs this script itself), typed.ts (all rows in one program), and the same rows in Go and C++ for comparison: main.go, kit.h, rows.cc, main.cc; rows.tsv.
One method for every column: a function with 12 sites of the operation and one with 4, the same but for the number of sites; a site's result is the next site's operand.
  bytes a site        = (bytes of f12 - bytes of f4) / 8
  instructions a site = (executed by N calls of f12 - executed by N calls of f4) / (8 N), each as a difference of two runs (perf stat -e instructions:u), callees included
Every program is `prog <row>_<4|12> <calls> <array length> <word> <verb0> <verb1>`: nothing the rows work on is a constant of the program text."""
import sys, os
W = sys.argv[1]; SKIP = set(sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else set()
import re
os.makedirs(W + '/alone', exist_ok=True)
N = (4, 12); R16 = range(16)
VERBS = ['GET', 'PUT', 'POST', 'HEAD', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']
ROWS = []
def row(name, what, ts=None, go=None, cc=None, call=None, extra=None, less=None, heavy=0, group='', final=None, isasync=False, zero=None, nested=False):
    def three(v):
        if v is None: return {'ts': '', 'go': '', 'cc': ''}
        if isinstance(v, str): return {'ts': v, 'go': v, 'cc': v}
        return {'ts': v.get('ts', ''), 'go': v.get('go', ''), 'cc': v.get('cc', '')}
    ROWS.append(dict(name=name, what=what, ts=ts, go=go, cc=cc, call=three(call), extra=three(extra), less=less, heavy=heavy, group=group, final=three(final), isasync=isasync, zero=zero, nested=nested))

ARROWS = int(os.environ.get('ARROWS', '4'))
TAILS = ['a + k', 'a + k + 1', '(a ^ 1) + k', 'a + k + 3', '(a ^ 2) + k', 'a + k + 5', '(a ^ 3) + k', 'a + k + 7']
def sixteen(n, form): return ', '.join(form % (1 + j % n, 'LEN + %d' % (j // n) if j >= n else 'LEN') for j in range(16))
WORK_TS = ' '.join('a = ((a + k) ^ G%d) | 0;' % (1 + j % 12) for j in range(24))
WORK_GO = '; '.join('a = (a + k) ^ G%d' % (1 + j % 12) for j in range(24))
WORK_CC = ' '.join('a = (a + k) ^ G%d;' % (1 + j % 12) for j in range(24))
# ---- fields
row('field_read', 'p = p.next: a reference read from a typed field', group='fields',
    ts=('(p: T): T', '', 'p = p.next;', 'p'), go=('(p *T) *T', '', 'p = p.next', 'p'), cc=('T* %s(T* p)', '', 'p = p->next;', 'p'), call='a = F(a)')
row('field_read_int', 'r ^= p.f: an integer read from a typed field, and one xor', group='fields',
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.f{i};', 'r'), go=('(p *T) int64', 'var r int64', 'r ^= p.f[{i}]', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'r ^= p->f[{i}];', 'r'), call='x ^= F(a)')
row('field_store_int', 'p.f = v: an integer stored to a typed field', group='fields',
    ts=('(p: T, v: number): T', 'const w = v | 0;', 'p.f{i} = w;', 'p'), go=('(p *T, v int64) *T', '', 'p.f[{i}] = v', 'p'), cc=('T* %s(T* p, long v)', '', 'p->f[{i}] = v;', 'p'), call='a = F(a, i)', final={'ts': ' ^ a.f0 ^ a.f1 ^ a.f2 ^ a.f3 ^ a.f4 ^ a.f5 ^ a.f6 ^ a.f7 ^ a.f8 ^ a.f9 ^ a.f10 ^ a.f11 ^ a.f12 ^ a.f13 ^ a.f14 ^ a.f15'})
row('field_increment', 'p.f++: a counter in an object (this.pos++)', group='fields',
    ts=('(p: T): T', '', 'p.f{i}++;', 'p'), go=('(p *T) *T', '', 'p.f[{i}]++', 'p'), cc=('T* %s(T* p)', '', 'p->f[{i}]++;', 'p'), call='a = F(a)', final={'ts': ' ^ a.f0 ^ a.f1 ^ a.f2 ^ a.f3 ^ a.f4 ^ a.f5 ^ a.f6 ^ a.f7 ^ a.f8 ^ a.f9 ^ a.f10 ^ a.f11 ^ a.f12 ^ a.f13 ^ a.f14 ^ a.f15'})
row('field_add_assign', 'p.f += v: a whole number added to a field (this.count += n)', group='fields',
    ts=('(p: T, v: number): T', '', 'p.f{i} += v;', 'p'), go=('(p *T, v int64) *T', '', 'p.f[{i}] += v', 'p'), cc=('T* %s(T* p, long v)', '', 'p->f[{i}] += v;', 'p'), call='a = F(a, i & 3)', final={'ts': ' ^ a.f0 ^ a.f1 ^ a.f2 ^ a.f3 ^ a.f4 ^ a.f5 ^ a.f6 ^ a.f7 ^ a.f8 ^ a.f9 ^ a.f10 ^ a.f11 ^ a.f12 ^ a.f13 ^ a.f14 ^ a.f15'})
row('field_store_double', 'p.d = v: a double stored to a typed field', group='fields',
    ts=('(p: T, v: number): T', '', 'p.d{i} = v;', 'p'), go=('(p *T, v float64) *T', '', 'p.d[{i}] = v', 'p'), cc=('T* %s(T* p, double v)', '', 'p->d[{i}] = v;', 'p'), call='a = F(a, y)', final={'ts': ' ^ (a.d0 | 0) ^ (a.d1 | 0) ^ (a.d2 | 0) ^ (a.d3 | 0) ^ (a.d4 | 0) ^ (a.d5 | 0) ^ (a.d6 | 0) ^ (a.d7 | 0) ^ (a.d8 | 0) ^ (a.d9 | 0) ^ (a.d10 | 0) ^ (a.d11 | 0) ^ (a.d12 | 0) ^ (a.d13 | 0) ^ (a.d14 | 0) ^ (a.d15 | 0)'})
row('field_store_ref', 'p.r = q: a reference stored to a typed field (stores side by side may share one barrier)', group='fields',
    ts=('(p: T, q: T): T', '', 'p.r{i} = q;', 'p'), go=('(p *T, q *T) *T', '', 'p.r[{i}] = q', 'p'), cc=('T* %s(T* p, T* q)', '', 'p->r[{i}] = q;', 'p'), call='a = F(a, A1)', final={'ts': ' ^ a.r0.f0 ^ a.r1.f0 ^ a.r2.f0 ^ a.r3.f0 ^ a.r4.f0 ^ a.r5.f0 ^ a.r6.f0 ^ a.r7.f0 ^ a.r8.f0 ^ a.r9.f0 ^ a.r10.f0 ^ a.r11.f0 ^ a.r12.f0 ^ a.r13.f0 ^ a.r14.f0 ^ a.r15.f0'})
row('field_store_ref_apart', 'p.next.r0 = q: the same, each store to another object', group='fields', less='field_read',
    ts=('(p: T, q: T): T', '', 'p.next.r0 = q; p = p.next;', 'p'), go=('(p *T, q *T) *T', '', 'p.next.r[0] = q; p = p.next', 'p'), cc=('T* %s(T* p, T* q)', '', 'p->next->r[0] = q; p = p->next;', 'p'), call='a = F(a, A1)', final={'ts': ' ^ a.r0.f0'})
row('optional_read', 'v = o.x; if (v !== undefined) r ^= v: an optional field (x?: number), present', group='fields',
    ts=('(o: Opt): number', 'let r = 0;', 'const v{i} = o.x{i}; if (v{i} !== undefined) r ^= v{i};', 'r'), go=('(o *Opt) int64', 'var r int64', 'if o.x[{i}].ok { r ^= o.x[{i}].v }', 'r'), cc=('long %s(Opt* o)', 'long r = 0;', 'if (o->x[{i}]) r ^= *o->x[{i}];', 'r'),
    call={'ts': 'x ^= F(o); o = o.next', 'go': 'x ^= F(o); o = o.next', 'cc': 'x ^= F(o); o = o->next'}, extra={'ts': 'let o = O0;', 'go': 'o := O0', 'cc': 'Opt* o = O0;'})
row('field_read_optional_absent', 'the same read of o.x with x?: number, and the objects have left the field out', group='fields', zero='nothing: an empty slot reads as undefined',
    ts=('(o: Opt): number', 'let r = 0;', 'const v{i} = o.x{i}; if (v{i} !== undefined) r ^= v{i};', 'r'), go=None, cc=None,
    call={'ts': 'x ^= F(o); o = o.next'}, extra={'ts': 'let o = OE0;'})
row('optional_store', 'o.x = v: a store to an optional field that is present', group='fields',
    ts=('(o: Opt, v: number): Opt', 'const w = v | 0;', 'o.x{i} = w;', 'o'), go=('(o *Opt, v int64) *Opt', '', 'o.x[{i}] = OptInt{v, true}', 'o'), cc=('Opt* %s(Opt* o, long v)', '', 'o->x[{i}] = v;', 'o'),
    call={'ts': 'o = F(o, i).next', 'go': 'o = F(o, i).next', 'cc': 'o = F(o, i)->next'}, extra={'ts': 'let o = O0;', 'go': 'o := O0', 'cc': 'Opt* o = O0;'}, final={'ts': ' ^ (o.x0 ?? 0) ^ (o.x1 ?? 0) ^ (o.x2 ?? 0) ^ (o.x3 ?? 0) ^ (o.x4 ?? 0) ^ (o.x5 ?? 0) ^ (o.x6 ?? 0) ^ (o.x7 ?? 0) ^ (o.x8 ?? 0) ^ (o.x9 ?? 0) ^ (o.x10 ?? 0) ^ (o.x11 ?? 0) ^ (o.x12 ?? 0) ^ (o.x13 ?? 0) ^ (o.x14 ?? 0) ^ (o.x15 ?? 0)', 'go': ' ^ o.x[0].v', 'cc': ' ^ *o->x[0]'})
row('interface_field_read', 'r ^= h.v with h: an interface that two classes of different layout implement (Go: a getter through an interface; C++: a field of the base class)', group='fields',
    ts=('(h: HasV): number', 'let r = 0;', 'r ^= h.v{i};', 'r'), go=('(h HasV) int64', 'var r int64', 'r ^= h.V{i}()', 'r'), cc=('long %s(HV* h)', 'long r = 0;', 'r ^= h->v[{i}];', 'r'),
    call={'ts': 'x ^= F(h); h = h.other', 'go': 'x ^= F(h); h = h.Other()', 'cc': 'x ^= F(h); h = h->other'}, extra={'ts': 'let h: HasV = H0;', 'go': 'h := H0', 'cc': 'HV* h = H0;'})
row('union_field_read', 'if (u.kind === "circle") r ^= u.r; else r ^= u.s; u = u.next: a union told apart by its kind (Go: a type switch; C++: a tag)', group='fields', less='field_read',
    ts=('(u: Shape): number', 'let r = 0;', 'if (u.kind === "circle") r ^= u.r; else r ^= u.s; u = u.next;', 'r'),
    go=('(u Shape) int64', 'var r int64', 'switch v := u.(type) { case *Circle: r ^= v.r; u = v.next; case *Square: r ^= v.s; u = v.next }', 'r'),
    cc=('long %s(Shape* u)', 'long r = 0;', 'if (u->kind == 0) r ^= u->r; else r ^= u->s; u = u->next;', 'r'), call='x ^= F(U0)')
row('nil_branch', 'if (p !== null) p = p.nn: a test for null and a branch', group='fields', less='field_read',
    ts=('(p: T | null): T | null', '', 'if (p !== null) p = p.nn;', 'p'), go=('(p *T) *T', '', 'if p != nil { p = p.nn }', 'p'), cc=('T* %s(T* p)', '', 'if (p) p = p->nn;', 'p'),
    call={'ts': 'a = F(a)!', 'go': 'a = F(a)', 'cc': 'a = F(a)'})
row('global_read', 'r ^= G: a module variable read, and one xor', group='fields',
    ts=('(): number', 'let r = 0;', 'r ^= G{i};', 'r'), go=('() int64', 'var r int64', 'r ^= G{i}', 'r'), cc=('long %s()', 'long r = 0;', 'r ^= G{i};', 'r'), call='x ^= F(); G3 = x & 7')
row('global_store_int', 'G = v: a module variable stored', group='fields',
    ts=('(v: number): void', '', 'G{i} = v;', ''), go=('(v int64)', '', 'G{i} = v', ''), cc=('void %s(long v)', '', 'G{i} = v;', ''), call='F(i & 7)', final={'ts': ' ^ G0 ^ G1 ^ G2 ^ G3 ^ G4 ^ G5 ^ G6 ^ G7 ^ G8 ^ G9 ^ G10 ^ G11 ^ G12 ^ G13 ^ G14 ^ G15'})
row('field_read_any', 'p = p.next with p: any, the object an instance of a class', group='fields', zero='the layout of what reaches p (flow: ProvenLayoutSets); then it is `field_read`',
    ts=('(p: any): any', '', 'p = p.next;', 'p'), go=None, cc=None, call={'ts': 'a = F(a)'})
row('field_read_any_twin', 'r ^= p.t.lanes with p: any, p and p.t instances of one class, and four kinds of literals that have a field `lanes` too and are made more often', group='fields', zero='the layout of what the field t holds; then it is two `field_read`',
    ts=('(p: any): number', 'let r = p.own | 0;', 'r ^= p.t{i}.lanes;', 'r'), go=None, cc=None, call={'ts': 'x ^= F(twA)'})
row('private_read', 'r ^= P.g(o), g a static method that returns o.#h: a private field of a class without a parent', group='fields',
    ts=('(o: PN): number', 'let r = 0;', 'r ^= PN.g{i}(o);', 'r'), go=None, cc=None, call={'ts': 'x ^= F(pnA)'})
row('private_store', 'P.s(o, v), s a static method that does o.#h = v', group='fields',
    ts=('(o: PN, v: number): PN', 'const w = v | 0;', 'PN.s{i}(o, w);', 'o'), go=None, cc=None, call={'ts': 'F(pnA, i)'}, final={'ts': ' ^ PN.g0(pnA) ^ PN.g11(pnA)'})
row('private_read_generic', 'r ^= o.m(h), m a method that returns this.#h, entered with an h that fails its entry check: the read in the generic version of m', group='fields',
    ts=('(o: PG, h: Host): number', 'let r = 0;', 'r ^= o.m{i}(h);', 'r'), go=None, cc=None, call={'ts': 'x ^= F(pgA, noHost)'})
row('field_read_builtin_parent', 'r ^= o.f with o: an instance of class B extends Error: field_read_int on a cell that a built-in constructor makes', group='fields', zero='slots for the fields of a class with a built-in parent; then it is `field_read_int`',
    ts=('(o: BP): number', 'let r = 0;', 'r ^= o.f{i};', 'r'), go=None, cc=None, call={'ts': 'x ^= F(bpA)'})
row('private_read_builtin_parent', 'private_read with class B extends Error', group='fields', zero='slots for the fields of a class with a built-in parent; then it is `private_read`',
    ts=('(o: BP): number', 'let r = 0;', 'r ^= BP.g{i}(o);', 'r'), go=None, cc=None, call={'ts': 'x ^= F(bpA)'})
row('private_store_builtin_parent', 'private_store with class B extends Error', group='fields', zero='slots for the fields of a class with a built-in parent; then it is `private_store`',
    ts=('(o: BP, v: number): BP', 'const w = v | 0;', 'BP.s{i}(o, w);', 'o'), go=None, cc=None, call={'ts': 'F(bpA, i)'}, final={'ts': ' ^ BP.g0(bpA) ^ BP.g11(bpA)'})
row('optional_chain', 'r ^= p.nn?.f ?? 0: the reference is there', group='fields',
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.nn?.f{i} ?? 0;', 'r'), go=('(p *T) int64', 'var r int64', 'if p.nn != nil { r ^= p.nn.f[{i}] }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (p->nn) r ^= p->nn->f[{i}];', 'r'), call='x ^= F(a)')
row('getter_call', 'r ^= o.size with `get size()` of a class nobody extends', group='fields',
    ts=('(o: WithGetter, r: number): number', '', 'r = (r + o.size) | 0;', 'r'), go=('(o *WithGetter, r int64) int64', '', 'r = r + o.Size()', 'r'), cc=('long %s(WithGetter* o, long r)', '', 'r = r + o->size();', 'r'), call={'ts': 'x = F((i & 1) === 0 ? wA : wB, x)', 'go': 'x = F(wg[i & 1], x)', 'cc': 'x = F(wg[i & 1], x)'})
# ---- numbers
row('add_int', 'r = (r + p.f) | 0: an integer added (with the read of a field)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = (r + p.f{i}) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'r = r + p.f[{i}]', 'r'), cc=('long %s(T* p, long r)', '', 'r = r + p->f[{i}];', 'r'), call='x = F(a, x)')
row('add_plain', 'r = r + p.f, whole numbers at run time, no "| 0" (with the read of a field)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = r + p.f{i};', 'r'), go=('(p *T, r int64) int64', '', 'r = r + p.f[{i}]', 'r'), cc=('long %s(T* p, long r)', '', 'r = r + p->f[{i}];', 'r'), call={'ts': 'x = F(a, x) & 65535', 'go': 'x = F(a, x) & 65535', 'cc': 'x = F(a, x) & 65535'})
row('add_double', 'r = r + p.d: a double added (with the read of a field)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = r + p.d{i};', 'r'), go=('(p *T, r float64) float64', '', 'r = r + p.d[{i}]', 'r'), cc=('double %s(T* p, double r)', '', 'r = r + p->d[{i}];', 'r'), call='y = F(a, y)')
row('mul_int', 'r = Math.imul(r, p.f): an integer multiplied (with the read of a field)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = Math.imul(r, p.f{i});', 'r'), go=('(p *T, r int64) int64', '', 'r = r * p.f[{i}]', 'r'), cc=('long %s(T* p, long r)', '', 'r = r * p->f[{i}];', 'r'), call='x = F(a, x)')
row('rem_int', 'r = ((r | 1024) % (p.f | 1)) | 0: the remainder of two integers of any sign (with the read of a field and two ors)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = ((r | 1024) % (p.f{i} | 1)) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'r = (r | 1024) % (p.f[{i}] | 1)', 'r'), cc=('long %s(T* p, long r)', '', 'r = (r | 1024) % (p->f[{i}] | 1);', 'r'), call='x = F(a, x)')
row('rem_const', 'r = ((r + p.f) % 7) | 0: the remainder by a constant (with the read of a field and a sum)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = ((r + p.f{i}) % 7) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'r = (r + p.f[{i}]) % 7', 'r'), cc=('long %s(T* p, long r)', '', 'r = (r + p->f[{i}]) % 7;', 'r'), call='x = F(a, x)')
row('rem_even', 'if (r % 2 === 0) r = (r + p.f) | 0; else r = (r + 3) | 0: is an integer of any sign even', group='numbers',
    ts=('(p: T, r: number): number', '', 'if (r % 2 === 0) r = (r + p.f{i}) | 0; else r = (r + 3) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'if r % 2 == 0 { r = r + p.f[{i}] } else { r = r + 3 }', 'r'), cc=('long %s(T* p, long r)', '', 'if (r % 2 == 0) r = r + p->f[{i}]; else r = r + 3;', 'r'), call={'ts': 'x = F(a, x) & 65535', 'go': 'x = F(a, x) & 65535', 'cc': 'x = F(a, x) & 65535'})
row('rem_test', 'if (r % (p.f | 1) === 0) r = (r + 1) | 0; else r = (r + 2) | 0: does one integer divide another', group='numbers',
    ts=('(p: T, r: number): number', '', 'if (r % (p.f{i} | 1) === 0) r = (r + 1) | 0; else r = (r + 2) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'if r % (p.f[{i}] | 1) == 0 { r = r + 1 } else { r = r + 2 }', 'r'), cc=('long %s(T* p, long r)', '', 'if (r % (p->f[{i}] | 1) == 0) r = r + 1; else r = r + 2;', 'r'), call={'ts': 'x = F(a, x) & 65535', 'go': 'x = F(a, x) & 65535', 'cc': 'x = F(a, x) & 65535'})
row('rem_element_even', 'if (p.l[0] % 2 === 0) r ^= k: is an element of a number[] even (with the read of the field and the element)', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'if (p.l{i}[0] % 2 === 0) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if p.l[{i}][0] % 2 == 0 { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (p->l[{i}][0] % 2 == 0) r ^= {i1};', 'r'), call='x ^= F(a)')
row('rem_generator', 'r = (r * 16807 + p.f) % 2147483647: a step of a linear congruential generator: the dividend is a whole number beyond 32 bits', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = (r * 16807 + p.f{i}) % 2147483647;', 'r'), go=('(p *T, r int64) int64', '', 'r = (r * 16807 + p.f[{i}]) % 2147483647', 'r'), cc=('long %s(T* p, long r)', '', 'r = (r * 16807 + p->f[{i}]) % 2147483647;', 'r'), call='x = F(a, x)')
row('neg_int', 'r = (-r + p.f) | 0: an integer negated (with the read of a field and a sum)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = (-r + p.f{i}) | 0;', 'r'), go=('(p *T, r int64) int64', '', 'r = -r + p.f[{i}]', 'r'), cc=('long %s(T* p, long r)', '', 'r = -r + p->f[{i}];', 'r'), call='x = F(a, x)')
row('number_is_nan', 'if (Number.isNaN(p.d)) r ^= k: is a double NaN (it is not)', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'if (Number.isNaN(p.d{i})) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if math.IsNaN(p.d[{i}]) { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (std::isnan(p->d[{i}])) r ^= {i1};', 'r'), call='x ^= F(a)')
row('number_is_finite', 'if (!Number.isFinite(p.d)) r ^= k: is a double finite (it is)', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'if (!Number.isFinite(p.d{i})) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if math.IsInf(p.d[{i}], 0) || math.IsNaN(p.d[{i}]) { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (!std::isfinite(p->d[{i}])) r ^= {i1};', 'r'), call='x ^= F(a)')
row('number_is_integer', 'if (Number.isInteger(p.d)) r ^= k: is a double a whole number (it is not)', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'if (Number.isInteger(p.d{i})) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if math.Trunc(p.d[{i}]) == p.d[{i}] { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (std::trunc(p->d[{i}]) == p->d[{i}]) r ^= {i1};', 'r'), call='x ^= F(a)')
row('mul_double', 'r = r * p.d: a double multiplied (with the read of a field)', group='numbers',
    ts=('(p: T, r: number): number', '', 'r = r * p.d{i};', 'r'), go=('(p *T, r float64) float64', '', 'r = r * p.d[{i}]', 'r'), cc=('double %s(T* p, double r)', '', 'r = r * p->d[{i}];', 'r'), call='y = F(a, 0.5)')
row('const_compare', 'if (p.f === 123) ..: a field compared with a constant, not taken', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'if (p.f{i} === 123) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if p.f[{i}] == 123 { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (p->f[{i}] == 123) r ^= {i1};', 'r'), call='x ^= F(a)')
row('int_branch', 'if (p.f0 === v) r ^= k; p = p.next: a field compared with a value, not equal', group='numbers', less='field_read',
    ts=('(p: T, v: number): number', 'let r = 0;', 'if (p.f0 === v) r ^= {i1}; p = p.next;', 'r'), go=('(p *T, v int64) int64', 'var r int64', 'if p.f[0] == v { r ^= {i1} }; p = p.next', 'r'), cc=('long %s(T* p, long v)', 'long r = 0;', 'if (p->f[0] == v) r ^= {i1}; p = p->next;', 'r'), call='x ^= F(a, -1 - i)')
row('less_than', 'if (p.f < v) r ^= k: a field compared by <, taken', group='numbers',
    ts=('(p: T, v: number): number', 'let r = 0;', 'if (p.f{i} < v) r ^= {i1};', 'r'), go=('(p *T, v int64) int64', 'var r int64', 'if p.f[{i}] < v { r ^= {i1} }', 'r'), cc=('long %s(T* p, long v)', 'long r = 0;', 'if (p->f[{i}] < v) r ^= {i1};', 'r'), call='x ^= F(a, 1000000 + i)')
row('switch_int', 'switch (p.f & 7) with eight cases', group='numbers',
    ts=('(p: T): number', 'let r = 0;', 'switch (p.f{i} & 7) { ' + ' '.join('case %d: r ^= {i8} + %d; break;' % (k, k * k + 1) for k in range(8)) + ' }', 'r'),
    go=('(p *T) int64', 'var r int64', 'switch p.f[{i}] & 7 { ' + ' '.join('case %d: r ^= {i8} + %d;' % (k, k * k + 1) for k in range(8)) + ' }', 'r'),
    cc=('long %s(T* p)', 'long r = 0;', 'switch (p->f[{i}] & 7) { ' + ' '.join('case %d: r ^= {i8} + %d; break;' % (k, k * k + 1) for k in range(8)) + ' }', 'r'), call='x ^= F(a)')
# ---- arrays
row('index_read', 'k = s[k]: an array of numbers read, checked', group='arrays',
    ts=('(s: number[], k: number): number', '', 'k = s[k];', 'k'), go=('(s []int64, k int64) int64', '', 'k = s[k]', 'k'), cc=('long %s(std::vector<long>& s, long k)', '', 'k = s.at(k);', 'k'), call='x ^= F(numbers, i & 31)')
row('index_store', 's[k] = k: an array of numbers written, checked', group='arrays', less='index_read',
    ts=('(s: number[], k: number): number', '', 's[k] = k; k = s[k + 1];', 'k'), go=('(s []int64, k int64) int64', '', 's[k] = k; k = s[k+1]', 'k'), cc=('long %s(std::vector<long>& s, long k)', '', 's.at(k) = k; k = s.at(k + 1);', 'k'), call='x ^= F(numbers, i & 31)')
row('index_read_ref', 'k = s[k].f0: an array of objects read, checked, and an integer field of the element', group='arrays',
    ts=('(s: T[], k: number): number', '', 'k = s[k].f0;', 'k'), go=('(s []*T, k int64) int64', '', 'k = s[k].f[0]', 'k'), cc=('long %s(std::vector<T*>& s, long k)', '', 'k = s.at(k)->f[0];', 'k'), call='x ^= F(nodes, i & 1)')
row('array_length', 'r ^= p.l.length', group='arrays', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.l{i}.length;', 'r'), go=('(p *T) int64', 'var r int64', 'r ^= int64(len(p.l[{i}]))', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'r ^= p->l[{i}].size();', 'r'), call='x ^= F(a)')
row('push', 's.push(v): arrays grown from empty to 4,096 or 12,288 elements, growth included', group='arrays',
    ts=('(s: number[], v: number): void', '', 's.push(v);', ''), go=('(s []int64, v int64) []int64', '', 's = append(s, v)', 's'), cc=('void %s(std::vector<long>& s, long v)', '', 's.push_back(v);', ''),
    call={'ts': 'F(arr, i); if ((i & 1023) === 1023) arr = []', 'go': 'arr = F(arr, i); if i&1023 == 1023 { arr = nil }', 'cc': 'F(arr, i); if ((i & 1023) == 1023) arr = std::vector<long>()'},
    extra={'ts': 'let arr: number[] = [];', 'go': 'var arr []int64', 'cc': 'std::vector<long> arr;'}, final={'ts': ' ^ arr.length', 'go': ' ^ int64(len(arr))', 'cc': ' ^ (long)arr.size()'})
row('loop_for_of', 'for (const v of p.l) r ^= v: a whole loop', group='arrays',
    ts=('(p: T): number', 'let r = 0;', 'for (const v of p.l{i}) r ^= v;', 'r'), go=('(p *T) int64', 'var r int64', 'for _, v := range p.l[{i}] { r ^= v }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'for (long v : p->l[{i}]) r ^= v;', 'r'), call='x ^= F(a)')
row('loop_counter', 'for (let j = 0; j < l.length; ++j) r ^= l[j]: a whole loop', group='arrays',
    ts=('(p: T): number', 'let r = 0;', '{ const l = p.l{i}; for (let j = 0; j < l.length; ++j) r ^= l[j]; }', 'r'), go=('(p *T) int64', 'var r int64', '{ l := p.l[{i}]; for j := 0; j < len(l); j++ { r ^= l[j] } }', 'r'),
    cc=('long %s(T* p)', 'long r = 0;', '{ auto& l = p->l[{i}]; for (size_t j = 0; j < l.size(); ++j) r ^= l[j]; }', 'r'), call='x ^= F(a)')
row('array_destructure', 'const [u, w] = p.l; r ^= u ^ w', group='arrays', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'const [u{i}, w{i}] = p.l{i}; r ^= u{i} ^ w{i};', 'r'), go=('(p *T) int64', 'var r int64', '{ l := p.l[{i}]; r ^= l[0] ^ l[1] }', 'r'), cc=('long %s(T* p)', 'long r = 0;', '{ auto& l = p->l[{i}]; r ^= l.at(0) ^ l.at(1); }', 'r'), call='x ^= F(a)')
row('array_includes', 'if (p.l.includes(v)) r ^= k: two elements, not found', group='arrays', less='field_read',
    ts=('(p: T, v: number): number', 'let r = 0;', 'if (p.l{i}.includes(v)) r ^= {i1};', 'r'), go=('(p *T, v int64) int64', 'var r int64', 'if slices.Contains(p.l[{i}], v) { r ^= {i1} }', 'r'),
    cc=('long %s(T* p, long v)', 'long r = 0;', 'if (std::find(p->l[{i}].begin(), p->l[{i}].end(), v) != p->l[{i}].end()) r ^= {i1};', 'r'), call='x ^= F(a, -1 - i)')
row('array_map', 'p.l.map(v => v + k)[0]: two elements, a new array, a closure; the collector included', group='arrays', less='field_read',
    ts=('(p: T, k: number): number', 'let r = 0;', 'r ^= p.l{i}.map((v: number): number => (v + k) | 0)[0];', 'r'),
    go=('(p *T, k int64) int64', 'var r int64', '{ l := p.l[{i}]; m := make([]int64, len(l)); for j, v := range l { m[j] = v + k }; sinkl = m; r ^= m[0] }', 'r'),
    cc=('long %s(T* p, long k)', 'long r = 0;', '{ auto& l = p->l[{i}]; std::vector<long> m(l.size()); std::transform(l.begin(), l.end(), m.begin(), [k](long v) { return v + k; }); r ^= m.at(0); }', 'r'), call='x ^= F(a, i)')
row('u8_read', 'k = b[k]: a Uint8Array read, checked', group='arrays',
    ts=('(b: Uint8Array, k: number): number', '', 'k = b[k];', 'k'), go=('(b []byte, k int64) int64', '', 'k = int64(b[k])', 'k'), cc=('long %s(std::vector<unsigned char>& b, long k)', '', 'k = b.at(k);', 'k'), call='x ^= F(bytes, i & 31)')
row('u8_store', 'b[k] = k: a Uint8Array written, checked', group='arrays', less='u8_read',
    ts=('(b: Uint8Array, k: number): number', '', 'b[k] = k; k = b[k + 1];', 'k'), go=('(b []byte, k int64) int64', '', 'b[k] = byte(k); k = int64(b[k+1])', 'k'), cc=('long %s(std::vector<unsigned char>& b, long k)', '', 'b.at(k) = k; k = b.at(k + 1);', 'k'), call='x ^= F(bytes, i & 31)')
# ---- strings
row('direct_call_string', 's = gi(s): a known function called with a string (ours: taken off the three rows below, whose results pass through it so that each stays a site of its own)', group='strings',
    ts=('(s: string): string', '', 's = gi(s);', 's'), go=('(s string) string', '', 's = gi(s)', 's'), cc=('std::string %s(std::string s)', '', 's = gi(std::move(s));', 's'),
    call={'ts': 'x ^= F(W0).length', 'go': 'x ^= int64(len(F(W0)))', 'cc': 'x ^= F(W0).size()'})
row('concat2', 's = s + t (ours: a rope; Go and C++ copy)', group='strings', less='ts:direct_call_string',
    ts=('(s: string, t: string): string', '', 's = gi(s + t);', 's'), go=('(s string, t string) string', '', 's = s + t', 's'), cc=('std::string %s(std::string s, const std::string& t)', '', 's = s + t;', 's'),
    call={'ts': 'x ^= F(W0, W1).length', 'go': 'x ^= int64(len(F(W0, W1)))', 'cc': 'x ^= F(W0, W1).size()'})
row('template3', 's = `${s}-${t}`', group='strings', less='ts:direct_call_string',
    ts=('(s: string, t: string): string', '', 's = gi(`${s}-${t}`);', 's'), go=('(s string, t string) string', '', 's = s + "-" + t', 's'), cc=('std::string %s(std::string s, const std::string& t)', '', 's = s + "-" + t;', 's'),
    call={'ts': 'x ^= F(W0, W1).length', 'go': 'x ^= int64(len(F(W0, W1)))', 'cc': 'x ^= F(W0, W1).size()'})
row('template_number', 's = `${t}${v}`: a number made text and joined (v below 1000)', group='strings', less='ts:direct_call_string',
    ts=('(t: string, v: number): string', 'let s = t;', 's = gi(`${t}${v + s.length}`);', 's'), go=('(t string, v int64) string', 's := t', 's = t + strconv.FormatInt(v + int64(len(s)), 10)', 's'),
    cc=('std::string %s(const std::string& t, long v)', 'std::string s = t;', 's = t + std::to_string(v + (long)s.size());', 's'),
    call={'ts': 'x ^= F(W1, i & 511).length', 'go': 'x ^= int64(len(F(W1, i & 511)))', 'cc': 'x ^= F(W1, i & 511).size()'})
row('string_literal', 'r = gs("literal", r): a constant text handed to a function', group='strings', less='direct_call',
    ts=('(r: number): number', '', 'r = gs("literal{i}", r);', 'r'), go=('(r int64) int64', '', 'r = gs("literal{i}", r)', 'r'), cc=('long %s(long r)', '', 'r = gs("literal{i}", r);', 'r'), call='x = F(x)')
row('string_eq_literal', 'if (s === "lit_aa") r ^= k: same length, differs in the last two characters', group='strings',
    ts=('(s: string): number', 'let r = 0;', 'if (s === "lit_{aa}") r ^= {i1};', 'r'), go=('(s string) int64', 'var r int64', 'if s == "lit_{aa}" { r ^= {i1} }', 'r'), cc=('long %s(const std::string& s)', 'long r = 0;', 'if (s == "lit_{aa}") r ^= {i1};', 'r'), call='x ^= F(WORD)')
row('string_eq_empty', 'if (p.ss === "") r ^= k: is a text in a field empty (it is not)', group='strings',
    ts=('(p: T): number', 'let r = 0;', 'if (p.ss{i} === "") r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if p.ss[{i}] == "" { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (p->ss[{i}] == "") r ^= {i1};', 'r'), call='x ^= F(a)')
row('string_eq', 'if (p.s === s) r ^= k; p = p.next: two texts of the same length that differ in the last character', group='strings', less='field_read',
    ts=('(p: T, s: string): number', 'let r = 0;', 'if (p.s === s) r ^= {i1}; p = p.next;', 'r'), go=('(p *T, s string) int64', 'var r int64', 'if p.s == s { r ^= {i1} }; p = p.next', 'r'), cc=('long %s(T* p, const std::string& s)', 'long r = 0;', 'if (p->s == s) r ^= {i1}; p = p->next;', 'r'), call='x ^= F(a, WORD)')
row('string_eq_equal', 'if (p.e === s) r ^= k; p = p.next: two equal texts in two objects (6 characters)', group='strings', less='field_read',
    ts=('(p: T, s: string): number', 'let r = 0;', 'if (p.e === s) r ^= {i1}; p = p.next;', 'r'), go=('(p *T, s string) int64', 'var r int64', 'if p.e == s { r ^= {i1} }; p = p.next', 'r'), cc=('long %s(T* p, const std::string& s)', 'long r = 0;', 'if (p->e == s) r ^= {i1}; p = p->next;', 'r'), call='x ^= F(a, WORD)')
row('string_length', 'r ^= p.ss.length', group='strings', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.ss{i}.length;', 'r'), go=('(p *T) int64', 'var r int64', 'r ^= int64(len(p.ss[{i}]))', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'r ^= p->ss[{i}].size();', 'r'), call='x ^= F(a)')
row('string_char', 'k = s.charCodeAt(k), checked', group='strings',
    ts=('(s: string, k: number): number', '', 'k = s.charCodeAt(k);', 'k'), go=('(s string, k int64) int64', '', 'k = int64(s[k])', 'k'), cc=('long %s(const std::string& s, long k)', '', 'k = s.at(k);', 'k'), call='x ^= F(codes, i & 31)')
row('loop_string', 'for (let j = 0; j < s.length; ++j) r = (r + s.charCodeAt(j)) | 0: a whole loop over 12 characters', group='strings',
    ts=('(s: string): number', 'let r = 0;', 'for (let j = 0; j < s.length; ++j) r = (r + s.charCodeAt(j)) | 0;', 'r'), go=('(s string) int64', 'var r int64', 'for j := 0; j < len(s); j++ { r += int64(s[j]) }', 'r'),
    cc=('long %s(const std::string& s)', 'long r = 0;', 'for (size_t j = 0; j < s.size(); ++j) r += s[j];', 'r'), call='x ^= F(repeated)')
row('string_slice', 's = s.slice(k) (no copy: Go a string, C++ a string_view)', group='strings',
    ts=('(s: string, k: number): string', '', 's = s.slice(k);', 's'), go=('(s string, k int64) string', '', 's = s[k:]', 's'), cc=('std::string_view %s(std::string_view s, long k)', '', 's = s.substr(k);', 's'),
    call={'ts': 'x ^= F(longs, 1 + (i & 1)).length', 'go': 'x ^= int64(len(F(longs, 1 + (i & 1))))', 'cc': 'x ^= F(longs, 1 + (i & 1)).size()'})
row('string_starts', 'if (p.ss.startsWith("t1")) r ^= k', group='strings', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'if (p.ss{i}.startsWith("t1")) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if strings.HasPrefix(p.ss[{i}], "t1") { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (p->ss[{i}].starts_with("t1")) r ^= {i1};', 'r'), call='x ^= F(a)')
row('string_switch', 'switch (p.m) with eight cases ("GET" .. "TRACE"); the texts at run time: DELETE, PATCH', group='strings', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'switch (p.m) { ' + ' '.join('case "%s": r ^= {i8} + %d; break;' % (v, k) for k, v in enumerate(VERBS)) + ' default: r ^= 99; } p = p.next;', 'r'),
    go=('(p *T) int64', 'var r int64', 'switch p.m { ' + ' '.join('case "%s": r ^= {i8} + %d;' % (v, k) for k, v in enumerate(VERBS)) + ' default: r ^= 99 }; p = p.next', 'r'),
    cc=('long %s(T* p)', 'long r = 0;', ' else '.join('if (p->m == "%s") r ^= {i8} + %d;' % (v, k) for k, v in enumerate(VERBS)) + ' else r ^= 99; p = p->next;', 'r'), call='x ^= F(a)')
row('string_less', 'if (p.ss < s) r ^= k: texts that differ in the first or second character', group='strings', less='field_read',
    ts=('(p: T, s: string): number', 'let r = 0;', 'if (p.ss{i} < s) r ^= {i1};', 'r'), go=('(p *T, s string) int64', 'var r int64', 'if p.ss[{i}] < s { r ^= {i1} }', 'r'), cc=('long %s(T* p, const std::string& s)', 'long r = 0;', 'if (p->ss[{i}] < s) r ^= {i1};', 'r'), call='x ^= F(a, WORD)')
row('string_index_of', 'r ^= p.ss.indexOf("1"): three or four characters', group='strings', less='field_read',
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.ss{i}.indexOf("1");', 'r'), go=('(p *T) int64', 'var r int64', 'r ^= int64(strings.Index(p.ss[{i}], "1"))', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'r ^= (long)p->ss[{i}].find("1");', 'r'), call='x ^= F(a)')
row('string_lower', 'p.m.toLowerCase().length: "DELETE", "PATCH"; the collector included', group='strings',
    ts=('(s: string): string', '', 's = gi(s.toLowerCase());', 's'), go=('(s string) string', '', 's = gi(strings.ToLower(s))', 's'), cc=None, less='direct_call_string',
    call={'ts': 'x ^= F(a.m).length', 'go': 'x ^= int64(len(F(a.m)))'})
row('array_join', 's = LJ[k].join(","): three short texts, 16 characters with the commas, joined into a new one; the collector included', group='strings', less='direct_call_string',
    ts=('(): string', 'let s = "";', 's = gi(LJ[{i}].join(","));', 's'), go=('() string', 's := ""', 's = gi(strings.Join(LJ[{i}], ","))', 's'),
    cc=('std::string %s()', 'std::string s;', '{ std::string t; for (size_t j = 0; j < LJ[{i}].size(); ++j) { if (j) t += ","; t += LJ[{i}][j]; } s = gi(std::move(t)); }', 's'),
    call={'ts': 'x ^= F().length', 'go': 'x ^= int64(len(F()))', 'cc': 'x ^= F().size()'})
row('regexp_test', 'if (/^t\\d+$/.test(p.ss)) r ^= k (Go: regexp.MatchString of a compiled expression; C++: std::regex_match)', group='strings', less='field_read', heavy=1,
    ts=('(p: T): number', 'let r = 0;', 'if (/^t\\d+$/.test(p.ss{i})) r ^= {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'if re1.MatchString(p.ss[{i}]) { r ^= {i1} }', 'r'), cc=('long %s(T* p)', 'long r = 0;', 'if (std::regex_match(p->ss[{i}], re1)) r ^= {i1};', 'r'), call='x ^= F(a)')
row('regexp_exec', 'm = /^t(\\d+)$/.exec(p.ss); if (m !== null) r ^= m[1].length (Go: FindStringSubmatch of a compiled expression)', group='strings', less='field_read', heavy=1,
    ts=('(p: T): number', 'let r = 0;', '{ const m = /^t(\\d+)$/.exec(p.ss{i}); if (m !== null) r ^= m[1].length + {i1}; }', 'r'), go=('(p *T) int64', 'var r int64', 'if m := re2.FindStringSubmatch(p.ss[{i}]); m != nil { r ^= int64(len(m[1])) + {i1} }', 'r'), cc=None, call='x ^= F(a)')
row('regexp_replace', 'r ^= p.ss.replace(/\\d+/g, "-").length (Go: ReplaceAllString of a compiled expression)', group='strings', less='field_read', heavy=1,
    ts=('(p: T): number', 'let r = 0;', 'r ^= p.ss{i}.replace(/\\d+/g, "-").length + {i1};', 'r'), go=('(p *T) int64', 'var r int64', 'r ^= int64(len(re3.ReplaceAllString(p.ss[{i}], "-"))) + {i1}', 'r'), cc=None, call='x ^= F(a)')
# ---- containers
row('map_get', 's = m.get(s)!: Map<string, string>, 16 keys', group='containers',
    ts=('(m: Map<string, string>, s: string): string', '', 's = m.get(s)!;', 's'), go=('(m map[string]string, s string) string', '', 's = m[s]', 's'), cc=('const std::string* %s(std::unordered_map<std::string, const std::string*>& m, const std::string* s)', '', 's = m.find(*s)->second;', 's'),
    call='w = F(table, w)', extra={'ts': 'let w = K0;', 'go': 'w := K0', 'cc': 'const std::string* w = K0;'}, final={'ts': ' ^ w.length', 'go': ' ^ int64(len(w))', 'cc': ' ^ (long)w->size()'})
row('map_get_int', 'k = m.get(k)!: Map<number, number>, 64 keys', group='containers',
    ts=('(m: Map<number, number>, k: number): number', '', 'k = m.get(k)!;', 'k'), go=('(m map[int64]int64, k int64) int64', '', 'k = m[k]', 'k'), cc=('long %s(std::unordered_map<long, long>& m, long k)', '', 'k = m.find(k)->second;', 'k'), call='x ^= F(itable, i & 63)')
row('map_set', 'm.set(p.ss, v): Map<string, number>, the key is there', group='containers', less='field_read',
    ts=('(m: Map<string, number>, p: T, v: number): void', '', 'm.set(p.ss{i}, v);', ''), go=('(m map[string]int64, p *T, v int64)', '', 'm[p.ss[{i}]] = v', ''), cc=('void %s(std::unordered_map<std::string, long>& m, T* p, long v)', '', 'm[p->ss[{i}]] = v;', ''), call='F(ntable, a, i)', final={'ts': ' ^ ntable.size ^ (ntable.get(a.ss3) ?? 0)'})
row('map_has', 'if (m.has(p.ss)) r ^= k: Map<string, number>, the key is there', group='containers', less='field_read',
    ts=('(m: Map<string, number>, p: T): number', 'let r = 0;', 'if (m.has(p.ss{i})) r ^= {i1};', 'r'), go=('(m map[string]int64, p *T) int64', 'var r int64', 'if _, ok := m[p.ss[{i}]]; ok { r ^= {i1} }', 'r'), cc=('long %s(std::unordered_map<std::string, long>& m, T* p)', 'long r = 0;', 'if (m.contains(p->ss[{i}])) r ^= {i1};', 'r'), call='x ^= F(ntable, a)')
row('set_has', 'if (st.has(p.ss)) r ^= k: Set<string>, the key is there', group='containers', less='field_read',
    ts=('(m: Set<string>, p: T): number', 'let r = 0;', 'if (m.has(p.ss{i})) r ^= {i1};', 'r'), go=('(m map[string]struct{}, p *T) int64', 'var r int64', 'if _, ok := m[p.ss[{i}]]; ok { r ^= {i1} }', 'r'), cc=('long %s(std::unordered_set<std::string>& m, T* p)', 'long r = 0;', 'if (m.contains(p->ss[{i}])) r ^= {i1};', 'r'), call='x ^= F(sset, a)')
row('set_add', 'st.add(p.ss): Set<string>, the key is there', group='containers', less='field_read',
    ts=('(m: Set<string>, p: T): void', '', 'm.add(p.ss{i});', ''), go=('(m map[string]struct{}, p *T)', '', 'm[p.ss[{i}]] = struct{}{}', ''), cc=('void %s(std::unordered_set<std::string>& m, T* p)', '', 'm.insert(p->ss[{i}]);', ''), call='F(sset, a)', final={'ts': ' ^ sset.size'})
row('record_get', 'r ^= d[p.ss]: Record<string, number> read with a key that is a variable', group='containers', less='field_read',
    ts=('(d: Record<string, number>, p: T): number', 'let r = 0;', 'r ^= d[p.ss{i}];', 'r'), go=('(m map[string]int64, p *T) int64', 'var r int64', 'r ^= m[p.ss[{i}]]', 'r'), cc=('long %s(std::unordered_map<std::string, long>& m, T* p)', 'long r = 0;', 'r ^= m.find(p->ss[{i}])->second;', 'r'),
    call={'ts': 'x ^= F(dict, a)', 'go': 'x ^= F(ntable, a)', 'cc': 'x ^= F(ntable, a)'})
row('any_read', 'r ^= m.literal with m: any: a read by name (Go, C++: a hash table asked for a constant text)', group='containers', zero='a layout for the object: the type of the value that reaches m (flow: ProvenLayoutSets), or a declared type in place of any',
    ts=('(m: any): number', 'let r = 0;', 'r ^= m.literal{i};', 'r'), go=('(m map[string]int64) int64', 'var r int64', 'r ^= m["literal{i}"]', 'r'), cc=('long %s(std::unordered_map<std::string_view, long>& m)', 'long r = 0;', 'r ^= m.find("literal{i}")->second;', 'r'), call='x ^= F(bag)')
row('any_store', 'm.literal = v with m: any: a store by name', group='containers', zero='the same',
    ts=('(m: any, v: number): void', '', 'm.literal{i} = v;', ''), go=('(m map[string]int64, v int64)', '', 'm["literal{i}"] = v', ''), cc=('void %s(std::unordered_map<std::string_view, long>& m, long v)', '', 'm["literal{i}"] = v;', ''), call='F(bag, i)', final={'ts': ' ^ bag.literal0 ^ bag.literal1 ^ bag.literal2 ^ bag.literal3 ^ bag.literal4 ^ bag.literal5 ^ bag.literal6 ^ bag.literal7 ^ bag.literal8 ^ bag.literal9 ^ bag.literal10 ^ bag.literal11 ^ bag.literal12 ^ bag.literal13 ^ bag.literal14 ^ bag.literal15'})
# ---- calls
row('direct_call', 'r = g1(r): a known function, one argument; with the callee (one test, one addition)', group='calls',
    ts=('(r: number): number', '', 'r = g1(r);', 'r'), go=('(r int64) int64', '', 'r = g1(r)', 'r'), cc=('long %s(long r)', '', 'r = g1(r);', 'r'), call='x = F(x)')
row('direct_call3', 'r = g3(r, a, b): three arguments, two of them alive across the calls; with the callee', group='calls',
    ts=('(r: number, a: number, b: number): number', '', 'r = g3(r, a, b);', 'r'), go=('(r int64, a int64, b int64) int64', '', 'r = g3(r, a, b)', 'r'), cc=('long %s(long r, long a, long b)', '', 'r = g3(r, a, b);', 'r'), call='x = F(x, i, 5)')
row('method_call_class', 'r = o.m(r): a method of a class nobody extends; with the callee', group='calls',
    ts=('(o: K, r: number): number', '', 'r = o.m(r);', 'r'), go=('(o *K, r int64) int64', '', 'r = o.m(r)', 'r'), cc=('long %s(K* o, long r)', '', 'r = o->m(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? kA : kB, x)', 'go': 'x = F(ks[i & 1], x)', 'cc': 'x = F(ks[i & 1], x)'})
row('method_call_frozen', 'r = o.m(r): method_call_class after Object.freeze(KF.prototype): a frozen prototype never changes again (Go, C++: the same call); with the callee', group='calls',
    ts=('(o: KF, r: number): number', '', 'r = o.m(r);', 'r'), go=('(o *K, r int64) int64', '', 'r = o.m(r)', 'r'), cc=('long %s(K* o, long r)', '', 'r = o->m(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? kfA : kfB, x)', 'go': 'x = F(ks[i & 1], x)', 'cc': 'x = F(ks[i & 1], x)'})
row('method_call', 'r = x.M(r): a method through an interface with two implementations, alternating; with the callee', group='calls',
    ts=('(o: I, r: number): number', '', 'r = o.M(r);', 'r'), go=('(o I, r int64) int64', '', 'r = o.M(r)', 'r'), cc=('long %s(V* o, long r)', '', 'r = o->M(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? iA : iB, x)', 'go': 'x = F(is[i & 1], x)', 'cc': 'x = F(is[i & 1], x)'})
row('func_value_call', 'r = f(r): a function value (one of two functions, alternating); with the callee', group='calls',
    ts=('(f: (a: number) => number, r: number): number', '', 'r = f(r);', 'r'), go=('(f func(int64) int64, r int64) int64', '', 'r = f(r)', 'r'), cc=('long %s(long (*f)(long), long r)', '', 'r = f(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? g1 : h1, x)', 'go': 'x = F(fs[i & 1], x)', 'cc': 'x = F(fs[i & 1], x)'})
row('closure_call', 'r = f(r): a closure that captured one variable (one of two, alternating); with the callee', group='calls',
    ts=('(f: (a: number) => number, r: number): number', '', 'r = f(r);', 'r'), go=('(f func(int64) int64, r int64) int64', '', 'r = f(r)', 'r'), cc=('long %s(std::function<long(long)>& f, long r)', '', 'r = f(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? cA : cB, x)', 'go': 'x = F(cs[i & 1], x)', 'cc': 'x = F(cs[i & 1], x)'})
FN = {'ts': '(f: (a: number) => number, r: number): number', 'go': '(f func(int64) int64, r int64) int64', 'cc': 'long %s(std::function<long(long)>& f, long r)'}
row('closure_call_two', 'r = f(r): 16 closures of TWO different arrows, one after the other from call to call of the row; with the callee', group='calls',
    ts=(FN['ts'], '', 'r = f(r);', 'r'), go=(FN['go'], '', 'r = f(r)', 'r'), cc=(FN['cc'], '', 'r = f(r);', 'r'), call='x = F(two[i & 15], x)')
row('closure_call_many', 'r = f(r): 16 closures of %d different arrows; with the callee' % ARROWS, group='calls',
    ts=(FN['ts'], '', 'r = f(r);', 'r'), go=(FN['go'], '', 'r = f(r)', 'r'), cc=(FN['cc'], '', 'r = f(r);', 'r'), call='x = F(many[i & 15], x)')
row('closure_call_field', 'r = h.f(r); h = h.next: the closure is kept in a field; 16 holders in a ring with closures of %d arrows, so the callee changes from site to site; with the callee' % ARROWS, group='calls', less='field_read',
    ts=('(h: Holder, r: number): number', '', 'r = h.f(r); h = h.next;', 'r'), go=('(h *Holder, r int64) int64', '', 'r = h.f(r); h = h.next', 'r'), cc=('long %s(Holder* h, long r)', '', 'r = h->f(r); h = h->next;', 'r'), call='x = F(HO0, x)')
row('closure_call_array', 'r = list[r & 15](r): the closure is kept in an array of 16 of %d arrows, and the data picks it; with the index, the bounds check and the callee' % ARROWS, group='calls',
    ts=('(list: ((a: number) => number)[], r: number): number', '', 'r = list[r & 15](r);', 'r'), go=('(list []func(int64) int64, r int64) int64', '', 'r = list[r & 15](r)', 'r'), cc=('long %s(std::vector<std::function<long(long)>>& list, long r)', '', 'r = list.at(r & 15)(r);', 'r'), call='x = F(many, x)')
row('closure_call_big', 'r = f(r): a closure (one of two, alternating) whose body runs 24 dependent steps every time: too big to inline; with the callee', group='calls', less='work24',
    ts=(FN['ts'], '', 'r = f(r);', 'r'), go=(FN['go'], '', 'r = f(r)', 'r'), cc=(FN['cc'], '', 'r = f(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? bigA : bigB, x) & 1023', 'go': 'x = F(bigs[i & 1], x) & 1023', 'cc': 'x = F(bigs[i & 1], x) & 1023'})
row('work24', 'the 24 steps of closure_call_big written at the site, no call', group='calls',
    ts=('(k: number, r: number): number', '', WORK_TS.replace('a', 'r'), 'r'), go=('(k int64, r int64) int64', '', WORK_GO.replace('a', 'r'), 'r'), cc=('long %s(long k, long r)', '', WORK_CC.replace('a', 'r'), 'r'), call='x = F(LEN + (i & 1), x) & 1023')
row('capture_read', 'r ^= c: a variable of the enclosing function read by a nested function (two instances of the enclosing function alive; another nested function assigns it), and one xor (Go, C++: a field of a struct handed to the function)', group='calls', nested=True,
    ts=('(): number', 'let r = 0;', 'r ^= c{i};', 'r'), go=('(s *Cap) int64', 'var r int64', 'r ^= s.c[{i}]', 'r'), cc=('long %s(Cap* s)', 'long r = 0;', 'r ^= s->c[{i}];', 'r'),
    call={'ts': 'const S = (i & 1) === 0 ? capture_read_A : capture_read_B; x ^= S.F(); S.set(codes, x & 7)', 'go': 'S := caps[i & 1]; x ^= F(S); capSet(S, codes, x & 7)', 'cc': 'Cap* S = caps[i & 1]; x ^= F(S); capSet(S, codes, x & 7)'})
row('capture_store', 'c = v: the same variable stored', group='calls', nested=True,
    ts=('(v: number): void', 'const w = v | 0;', 'c{i} = w;', ''), go=('(s *Cap, v int64)', '', 's.c[{i}] = v', ''), cc=('void %s(Cap* s, long v)', '', 's->c[{i}] = v;', ''),
    call={'ts': 'const S = (i & 1) === 0 ? capture_store_A : capture_store_B; S.F(i & 7)', 'go': 'F(caps[i & 1], i & 7)', 'cc': 'F(caps[i & 1], i & 7)'}, final={'ts': ' ^ capture_store_A.sum() ^ capture_store_B.sum()', 'go': ' ^ capSum(caps[0]) ^ capSum(caps[1])', 'cc': ' ^ capSum(caps[0]) ^ capSum(caps[1])'})
row('capture_string_char', 'k = text.charCodeAt(k) with text: string a variable of the enclosing function (a scanner made of nested functions)', group='calls', nested=True,
    ts=('(k: number): number', '', 'k = text.charCodeAt(k);', 'k'), go=('(s *Cap, k int64) int64', '', 'k = int64(s.text[k])', 'k'), cc=('long %s(Cap* s, long k)', '', 'k = s->text.at(k);', 'k'),
    call={'ts': 'const S = (i & 1) === 0 ? capture_string_char_A : capture_string_char_B; x ^= S.F(i & 31); S.set(codes, 0)', 'go': 'S := caps[i & 1]; x ^= F(S, i & 31); capSet(S, codes, 0)', 'cc': 'Cap* S = caps[i & 1]; x ^= F(S, i & 31); capSet(S, codes, 0)'})
row('sibling_call', 'r = inner(r): a nested function calls a function declared beside it, which reads a variable of the enclosing function; with the callee', group='calls', nested=True,
    ts=('(r: number): number', '', 'r = inner(r);', 'r'), go=('(s *Cap, r int64) int64', '', 'r = capInner(s, r)', 'r'), cc=('long %s(Cap* s, long r)', '', 'r = capInner(s, r);', 'r'),
    call={'ts': 'const S = (i & 1) === 0 ? sibling_call_A : sibling_call_B; x = S.F(x)', 'go': 'x = F(caps[i & 1], x)', 'cc': 'x = F(caps[i & 1], x)'})
row('bound_call', 'r = f(r) with f = o.m.bind(o) (Go: a method value; C++: std::function of std::bind_front); with the callee', group='calls',
    ts=('(f: (a: number) => number, r: number): number', '', 'r = f(r);', 'r'), go=('(f func(int64) int64, r int64) int64', '', 'r = f(r)', 'r'), cc=('long %s(std::function<long(long)>& f, long r)', '', 'r = f(r);', 'r'), call={'ts': 'x = F((i & 1) === 0 ? bA : bB, x)', 'go': 'x = F(bs[i & 1], x)', 'cc': 'x = F(bs[i & 1], x)'})
row('try_catch', 'try { r = g1(r) } catch { r = -1 }: entering and leaving, nothing thrown', group='calls', less='direct_call',
    ts=('(r: number): number', '', 'try { r = g1(r); } catch (e) { r = -{i1}; }', 'r'), go=None, cc=('long %s(long r)', '', 'try { r = g1(r); } catch (...) { r = -{i1}; }', 'r'), call='x = F(x)')
row('throw_catch', 'try { throw new Error("x") } catch { r += 1 }: thrown and caught in one function (Go: panic and recover; C++: throw std::runtime_error)', group='calls', heavy=1,
    ts=('(r: number): number', '', 'try { if (r >= 0) throw new Error("x"); } catch (e) { r = (r + {i1}) | 0; }', 'r'),
    go=('(r int64) int64', '', 'func() { defer func() { if recover() != nil { r = r + {i1} } }(); if r >= 0 { panic(errX) } }()', 'r'),
    cc=('long %s(long r)', '', 'try { if (r >= 0) throw std::runtime_error("x"); } catch (std::exception&) { r = r + {i1}; }', 'r'), call='x = F(x & 65535)')
# ---- objects born inside objects
row('nested_read', 'r ^= p.c.d; p = p.next: a field of the object that p was born with in its field c (Go, C++: a struct held by value)', group='fields', less='field_read',
    ts=('(p: NS): number', 'let r = 0;', 'r ^= p.c.d; p = p.next;', 'r'), go=('(p *NS) int64', 'var r int64', 'r ^= p.c.d; p = p.next', 'r'), cc=('long %s(NS* p)', 'long r = 0;', 'r ^= p->c.d; p = p->next;', 'r'),
    call={'ts': 'x ^= F(ns); ns = ns.next', 'go': 'x ^= F(ns); ns = ns.next', 'cc': 'x ^= F(ns); ns = ns->next'}, extra={'ts': 'let ns = NS0;', 'go': 'ns := NS0', 'cc': 'NS* ns = NS0;'})
row('nested_store', 'p.c.d = v; p = p.next: a store to a field of that object', group='fields', less='field_read',
    ts=('(p: NS, v: number): NS', 'const w = v | 0;', 'p.c.d = w; p = p.next;', 'p'), go=('(p *NS, v int64) *NS', '', 'p.c.d = v; p = p.next', 'p'), cc=('NS* %s(NS* p, long v)', '', 'p->c.d = v; p = p->next;', 'p'),
    call={'ts': 'ns = F(ns, i)', 'go': 'ns = F(ns, i)', 'cc': 'ns = F(ns, i)'}, extra={'ts': 'let ns = NS0;', 'go': 'ns := NS0', 'cc': 'NS* ns = NS0;'}, final={'ts': ' ^ ns.c.d ^ ns.next.c.d', 'go': ' ^ ns.c.d ^ ns.next.c.d', 'cc': ' ^ ns->c.d ^ ns->next->c.d'})
row('nested_pass', 'r ^= inner(p.c); p = p.next: that object handed to a function that reads one field (Go, C++: a pointer into the struct)', group='calls', less='field_read',
    ts=('(p: NS): number', 'let r = 0;', 'r ^= takeNI(p.c); p = p.next;', 'r'), go=('(p *NS) int64', 'var r int64', 'r ^= takeNI(&p.c); p = p.next', 'r'), cc=('long %s(NS* p)', 'long r = 0;', 'r ^= takeNI(&p->c); p = p->next;', 'r'),
    call={'ts': 'x ^= F(ns); ns = ns.next', 'go': 'x ^= F(ns); ns = ns.next', 'cc': 'x ^= F(ns); ns = ns->next'}, extra={'ts': 'let ns = NS0;', 'go': 'ns := NS0', 'cc': 'NS* ns = NS0;'})
row('nested_new', 'p = { next: p, c: { d: k, e: 0 }, f: 0 }: an object born with an object in a field; the collector included', group='allocation',
    ts=('(p: NL | null): NL | null', '', 'p = { next: p, c: { d: {i}, e: 0 }, f: 0 };', 'p'), go=('(p *NL) *NL', '', 'p = &NL{next: p, c: NI{d: {i}}}', 'p'), cc=('NL* %s(NL* p)', '', 'p = new NL{p, {{i}, 0}, 0};', 'p'),
    final={'ts': ' ^ walkN()'}, call={'ts': 'ringN[i & 7] = F(null)', 'go': 'sinkN = F(nil)', 'cc': 'sinkN = F(nullptr); while (sinkN) { NL* q = sinkN->next; delete sinkN; sinkN = q; }'})
row('nested_new_class', 'p = new NC(p, k), whose constructor does this.c = new NI2(k); the collector included', group='allocation',
    ts=('(p: NC | null): NC | null', '', 'p = new NC(p, {i});', 'p'), go=('(p *NL) *NL', '', 'p = &NL{next: p, c: NI{d: {i}}}', 'p'), cc=('NL* %s(NL* p)', '', 'p = new NL{p, {{i}, 0}, 0};', 'p'),
    final={'ts': ' ^ walkNC()'}, call={'ts': 'ringNC[i & 7] = F(null)', 'go': 'sinkN = F(nil)', 'cc': 'sinkN = F(nullptr); while (sinkN) { NL* q = sinkN->next; delete sinkN; sinkN = q; }'})
row('array_field_new', 'p = { next: p, items: [], f: 0 }: an object born with an empty array in a field (Go: a slice of capacity 5; C++: an empty vector); the collector included', group='allocation',
    ts=('(p: AL | null): AL | null', '', 'p = { next: p, items: [], f: {i} };', 'p'), go=('(p *AL) *AL', '', 'p = &AL{next: p, items: make([]int64, 0, 5), f: {i}}', 'p'), cc=('AL* %s(AL* p)', '', 'p = new AL{p, {}, {i}};', 'p'),
    final={'ts': ' ^ walkA()'}, call={'ts': 'ringA[i & 7] = F(null)', 'go': 'sinkA = F(nil)', 'cc': 'sinkA = F(nullptr); while (sinkA) { AL* q = sinkA->next; delete sinkA; sinkA = q; }'})
row('array_field_new3', 'p = { next: p, items: [k, k, k], f: 0 }: an object born with an array of three numbers in a field; the collector included', group='allocation',
    ts=('(p: AL | null): AL | null', '', 'p = { next: p, items: [{i}, {i}, {i}], f: 0 };', 'p'), go=('(p *AL) *AL', '', 'p = &AL{next: p, items: []int64{{i}, {i}, {i}}}', 'p'), cc=('AL* %s(AL* p)', '', 'p = new AL{p, {{i}, {i}, {i}}, 0};', 'p'),
    final={'ts': ' ^ walkA()'}, call={'ts': 'ringA[i & 7] = F(null)', 'go': 'sinkA = F(nil)', 'cc': 'sinkA = F(nullptr); while (sinkA) { AL* q = sinkA->next; delete sinkA; sinkA = q; }'})
row('array_field_new_class', 'p = new AC(p, k), whose constructor does this.items = []; the collector included', group='allocation',
    ts=('(p: AC | null): AC | null', '', 'p = new AC(p, {i});', 'p'), go=('(p *AL) *AL', '', 'p = &AL{next: p, items: make([]int64, 0, 5), f: {i}}', 'p'), cc=('AL* %s(AL* p)', '', 'p = new AL{p, {}, {i}};', 'p'),
    final={'ts': ' ^ walkAC()'}, call={'ts': 'ringAC[i & 7] = F(null)', 'go': 'sinkA = F(nil)', 'cc': 'sinkA = F(nullptr); while (sinkA) { AL* q = sinkA->next; delete sinkA; sinkA = q; }'})
# ---- allocation
row('new_object', 'p = new T2(p, k): a small object of a class, three fields; the collector included', group='allocation',
    ts=('(p: T2 | null): T2 | null', '', 'p = new T2(p, {i});', 'p'), go=('(p *T2) *T2', '', 'p = &T2{next: p, a: {i}}', 'p'), cc=('T2* %s(T2* p)', '', 'p = new T2{p, {i}, 0};', 'p'),
    final={'ts': ' ^ walk2()'}, call={'ts': 'ring2[i & 7] = F(null)', 'go': 'sink2 = F(nil)', 'cc': 'sink2 = F(nullptr); while (sink2) { T2* q = sink2->next; delete sink2; sink2 = q; }'})
row('new_object_private', 'new_object with the three fields private and declared without a value (#a: number;), stored by the constructor', group='allocation',
    ts=('(p: TP | null): TP | null', '', 'p = new TP(p, {i});', 'p'), go=('(p *T2) *T2', '', 'p = &T2{next: p, a: {i}}', 'p'), cc=('T2* %s(T2* p)', '', 'p = new T2{p, {i}, 0};', 'p'),
    final={'ts': ' ^ walkP()'}, call={'ts': 'ringP[i & 7] = F(null)', 'go': 'sink2 = F(nil)', 'cc': 'sink2 = F(nullptr); while (sink2) { T2* q = sink2->next; delete sink2; sink2 = q; }'})
row('private_define', 'new_object with the three fields private, two of them defined with a value (#a = 1)', group='allocation',
    ts=('(p: TD | null): TD | null', '', 'p = new TD(p, {i});', 'p'), go=('(p *T2) *T2', '', 'p = &T2{next: p, a: {i}}', 'p'), cc=('T2* %s(T2* p)', '', 'p = new T2{p, {i}, 0};', 'p'),
    final={'ts': ' ^ walkD()'}, call={'ts': 'ringD[i & 7] = F(null)', 'go': 'sink2 = F(nil)', 'cc': 'sink2 = F(nullptr); while (sink2) { T2* q = sink2->next; delete sink2; sink2 = q; }'})
row('new_object_private_unknown', 'new_object_private with a class one of whose objects has reached run-time text, so that flow knows nothing of the layout', group='allocation',
    ts=('(p: TQ | null): TQ | null', '', 'p = new TQ(p, {i});', 'p'), go=('(p *T2) *T2', '', 'p = &T2{next: p, a: {i}}', 'p'), cc=('T2* %s(T2* p)', '', 'p = new T2{p, {i}, 0};', 'p'),
    final={'ts': ' ^ walkQ()'}, call={'ts': 'ringQ[i & 7] = F(null)', 'go': 'sink2 = F(nil)', 'cc': 'sink2 = F(nullptr); while (sink2) { T2* q = sink2->next; delete sink2; sink2 = q; }'})
row('object_literal', 'p = { next: p, a: k, b: 0 }; the collector included', group='allocation',
    ts=('(p: L2 | null): L2 | null', '', 'p = { next: p, a: {i}, b: 0 };', 'p'), go=('(p *T2) *T2', '', 'p = &T2{next: p, a: {i}}', 'p'), cc=('T2* %s(T2* p)', '', 'p = new T2{p, {i}, 0};', 'p'),
    final={'ts': ' ^ walk3()'}, call={'ts': 'ring3[i & 7] = F(null)', 'go': 'sink2 = F(nil)', 'cc': 'sink2 = F(nullptr); while (sink2) { T2* q = sink2->next; delete sink2; sink2 = q; }'})
row('new_closure', 'a closure that captures one value is made; the collector included', group='allocation',
    ts=('(f: () => number): () => number', '', 'f = ((g: () => number) => () => g() + {i})(f);', 'f'), go=('(f func() int64) func() int64', '', 'f = func(g func() int64) func() int64 { return func() int64 { return g() + {i} } }(f)', 'f'), cc=None, call='sinkf = F(z0)', final={'ts': ' ^ sinkf()'})
row('array_literal_values', 'p.l = [a, a, a, a]: an array of four values made and stored to a field; the collector included', group='allocation',
    ts=('(p: T, a: number): T', '', 'p.l{i} = [a, a, a, a];', 'p'), go=('(p *T, a int64) *T', '', 'p.l[{i}] = []int64{a, a, a, a}', 'p'), cc=('T* %s(T* p, long a)', '', 'p->l[{i}] = std::vector<long>{a, a, a, a};', 'p'), call='a = F(a, i)', final={'ts': ' ^ a.l0[0] ^ a.l1[0] ^ a.l2[0] ^ a.l3[0] ^ a.l4[0] ^ a.l5[0] ^ a.l6[0] ^ a.l7[0] ^ a.l8[0] ^ a.l9[0] ^ a.l10[0] ^ a.l11[0] ^ a.l12[0] ^ a.l13[0] ^ a.l14[0] ^ a.l15[0]'})
row('array_literal_constants', 'p.l = [k, 12, .. 26]: an array of sixteen constants made and stored to a field; the collector included', group='allocation',
    ts=('(p: T): T', '', 'p.l{i} = [{i}, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];', 'p'), go=('(p *T) *T', '', 'p.l[{i}] = []int64{{i}, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26}', 'p'),
    cc=('T* %s(T* p)', '', 'p->l[{i}] = std::vector<long>{{i}, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26};', 'p'), call='a = F(a)', final={'ts': ' ^ a.l0[1] ^ a.l1[1] ^ a.l2[1] ^ a.l3[1] ^ a.l4[1] ^ a.l5[1] ^ a.l6[1] ^ a.l7[1] ^ a.l8[1] ^ a.l9[1] ^ a.l10[1] ^ a.l11[1] ^ a.l12[1] ^ a.l13[1] ^ a.l14[1] ^ a.l15[1]'})
row('array_literal_three_constants', 'p.l = [k, 2, 3]: an array of three constants made and stored to a field; the collector included', group='allocation',
    ts=('(p: T): T', '', 'p.l{i} = [{i}, 2, 3];', 'p'), go=('(p *T) *T', '', 'p.l[{i}] = []int64{{i}, 2, 3}', 'p'), cc=('T* %s(T* p)', '', 'p->l[{i}] = std::vector<long>{{i}, 2, 3};', 'p'), call='a = F(a)',
    final={'ts': ' ^ ' + ' ^ '.join('a.l%d[1]' % i for i in R16)})
row('array_literal_strings', 'LS[k] = ["a", "bb", "ccc"]: an array of three constant strings made and stored to an element; the collector included', group='allocation',
    ts=('(): void', '', 'LS[{i}] = ["a{i}", "bb", "ccc"];', ''), go=('()', '', 'LS[{i}] = []string{"a{i}", "bb", "ccc"}', ''), cc=('void %s()', '', 'LS[{i}] = std::vector<std::string_view>{"a{i}", "bb", "ccc"};', ''), call='F()',
    final={'ts': ' ^ LS[0].length ^ LS[3][1].length', 'go': ' ^ int64(len(LS[0])) ^ int64(len(LS[3][1]))', 'cc': ' ^ (long)LS[0].size() ^ (long)LS[3][1].size()'})
row('array_literal_objects', 'LR[k] = [{ k, v: 1 }, { k: 2, v: 3 }]: an array of two constant objects (Go, C++: structs by value, one allocation); the collector included', group='allocation',
    ts=('(): void', '', 'LR[{i}] = [{ k: {i}, v: 1 }, { k: 2, v: 3 }];', ''), go=('()', '', 'LR[{i}] = []KV{{{i}, 1}, {2, 3}}', ''), cc=('void %s()', '', 'LR[{i}] = std::vector<KV>{{{i}, 1}, {2, 3}};', ''), call='F()',
    final={'ts': ' ^ LR[0].length ^ LR[3][1].v', 'go': ' ^ int64(len(LR[0])) ^ LR[3][1].v', 'cc': ' ^ (long)LR[0].size() ^ LR[3][1].v'})
row('table_literal', 'LR[k] = a table of 24 constant objects { k, v } (Go, C++: structs by value, one allocation); the collector included', group='allocation', heavy=1,
    ts=('(): void', '', 'LR[{i}] = [{ k: {i}, v: 0 }, { k: 1, v: 3 }, { k: 2, v: 6 }, { k: 3, v: 9 }, { k: 4, v: 12 }, { k: 5, v: 15 }, { k: 6, v: 18 }, { k: 7, v: 21 }, { k: 8, v: 24 }, { k: 9, v: 27 }, { k: 10, v: 30 }, { k: 11, v: 33 }, { k: 12, v: 36 }, { k: 13, v: 39 }, { k: 14, v: 42 }, { k: 15, v: 45 }, { k: 16, v: 48 }, { k: 17, v: 51 }, { k: 18, v: 54 }, { k: 19, v: 57 }, { k: 20, v: 60 }, { k: 21, v: 63 }, { k: 22, v: 66 }, { k: 23, v: 69 }];', ''), go=('()', '', 'LR[{i}] = []KV{{{i}, 0}, {1, 3}, {2, 6}, {3, 9}, {4, 12}, {5, 15}, {6, 18}, {7, 21}, {8, 24}, {9, 27}, {10, 30}, {11, 33}, {12, 36}, {13, 39}, {14, 42}, {15, 45}, {16, 48}, {17, 51}, {18, 54}, {19, 57}, {20, 60}, {21, 63}, {22, 66}, {23, 69}}', ''), cc=('void %s()', '', 'LR[{i}] = std::vector<KV>{{{i}, 0}, {1, 3}, {2, 6}, {3, 9}, {4, 12}, {5, 15}, {6, 18}, {7, 21}, {8, 24}, {9, 27}, {10, 30}, {11, 33}, {12, 36}, {13, 39}, {14, 42}, {15, 45}, {16, 48}, {17, 51}, {18, 54}, {19, 57}, {20, 60}, {21, 63}, {22, 66}, {23, 69}};', ''), call='F()',
    final={'ts': ' ^ LR[0].length ^ LR[3][1].v', 'go': ' ^ int64(len(LR[0])) ^ LR[3][1].v', 'cc': ' ^ (long)LR[0].size() ^ LR[3][1].v'})
row('object_spread', 'p = { ...p, a: k }: three fields; the collector included (Go, C++: a struct copied by value)', group='allocation',
    ts=('(p: P3): P3', '', 'p = { ...p, a: {i} };', 'p'), go=('(p P3) P3', '', '{ q := p; q.a = {i}; p = q }', 'p'), cc=('P3 %s(P3 p)', '', '{ P3 q = p; q.a = {i}; p = q; }', 'p'),
    call={'ts': 'ring4[i & 7] = F(ring4[(i + 1) & 7])', 'go': 'p3 = F(p3)', 'cc': 'p3 = F(p3)'}, final={'ts': ' ^ walk4()', 'go': ' ^ p3.a ^ p3.b', 'cc': ' ^ p3.a ^ p3.b'})
# ---- tests of type
row('typeof_test', 'if (typeof p.u === "string") r ^= k: a field of type string | number (half are strings)', group='type tests',
    ts=('(p: TU): number', 'let r = 0;', 'if (typeof p.u{i} === "string") r ^= {i1};', 'r'), go=('(p *TU) int64', 'var r int64', 'if _, ok := p.u[{i}].(string); ok { r ^= {i1} }', 'r'), cc=('long %s(TU* p)', 'long r = 0;', 'if (std::holds_alternative<std::string>(p->u[{i}])) r ^= {i1};', 'r'), call='x ^= F(UU0)')
row('instanceof_test', 'if (p.b instanceof D1) r ^= k: a field of a base class with two subclasses (half are D1)', group='type tests',
    ts=('(p: TB): number', 'let r = 0;', 'if (p.b{i} instanceof D1) r ^= {i1};', 'r'), go=('(p *TB) int64', 'var r int64', 'if _, ok := p.b[{i}].(*D1); ok { r ^= {i1} }', 'r'), cc=('long %s(TB* p)', 'long r = 0;', 'if (dynamic_cast<D1*>(p->b[{i}])) r ^= {i1};', 'r'), call='x ^= F(BB0)')
row('type_test', 'p = p.any as T: a value of type unknown taken for a class (Go: p.any.(*T), checked; C++: dynamic_cast)', group='type tests',
    ts=('(p: T): T', '', 'p = p.any as T;', 'p'), go=('(p *T) *T', '', 'p = p.any.(*T)', 'p'), cc=('B* %s(B* p)', '', 'p = dynamic_cast<D*>(p)->other;', 'p'), call={'ts': 'a = F(a)', 'go': 'a = F(a)', 'cc': 'bd = F(bd)'}, extra={'cc': 'B* bd = BD0;'}, final={'cc': ' ^ (bd != nullptr)'})
# ---- JSON, await
row('json_stringify', 'JSON.stringify(o) of { id, name, ok, tags: [2 strings] } (Go: encoding/json)', group='JSON, await', heavy=1,
    ts=('(o: Rec): number', 'let r = 0;', 'r ^= JSON.stringify(o).length + {i};', 'r'), go=('(o *Rec) int64', 'var r int64', '{ b, _ := json.Marshal(o); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(rec)')
row('json_parse', '(JSON.parse(t) as Rec).id of the same record, 58 characters (Go: encoding/json into a struct)', group='JSON, await', heavy=1,
    ts=('(t: string): number', 'let r = 0;', 'r ^= (JSON.parse(t) as Rec).id + {i};', 'r'), go=('(t []byte) int64', 'var r int64', '{ var o Rec; json.Unmarshal(t, &o); r ^= o.Id + {i} }', 'r'), cc=None, call={'ts': 'x ^= F(text)', 'go': 'x ^= F(textb)'})
row('json_stringify_literal', 'JSON.stringify({ id: r, name: w, ok: true }): a literal that nothing else sees (Go: encoding/json of a struct value)', group='JSON, await', heavy=1,
    ts=('(w: string): number', 'let r = 0;', 'r ^= JSON.stringify({ id: r, name: w, ok: true }).length + {i};', 'r'), go=('(w string) int64', 'var r int64', '{ b, _ := json.Marshal(Lit{r, w, true}); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(a.s)')
row('json_stringify_nested', 'JSON.stringify(o) of { head: Rec, tail: Rec, label }', group='JSON, await', heavy=1,
    ts=('(o: Rec2): number', 'let r = 0;', 'r ^= JSON.stringify(o).length + {i};', 'r'), go=('(o *Rec2) int64', 'var r int64', '{ b, _ := json.Marshal(o); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(rec2)')
row('json_stringify_array', 'JSON.stringify(l) of eight records', group='JSON, await', heavy=1,
    ts=('(l: Rec[]): number', 'let r = 0;', 'r ^= JSON.stringify(l).length + {i};', 'r'), go=('(l []*Rec) int64', 'var r int64', '{ b, _ := json.Marshal(l); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(recs)')
row('json_stringify_any', 'JSON.stringify(o) with o: any, the record as JSON.parse made it (Go: a map[string]any)', group='JSON, await', heavy=1,
    ts=('(o: any): number', 'let r = 0;', 'r ^= JSON.stringify(o).length + {i};', 'r'), go=('(o any) int64', 'var r int64', '{ b, _ := json.Marshal(o); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(recAny)')
row('json_stringify_indented', 'JSON.stringify(o, null, 2) of the record (Go: json.MarshalIndent)', group='JSON, await', heavy=1,
    ts=('(o: Rec): number', 'let r = 0;', 'r ^= JSON.stringify(o, null, 2).length + {i};', 'r'), go=('(o *Rec) int64', 'var r int64', '{ b, _ := json.MarshalIndent(o, "", "  "); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(rec)')
row('json_stringify_text', 'JSON.stringify(o) of { role, text }: 2,000 characters of text with a line break, a tab and two quotes in every 50', group='JSON, await', heavy=1,
    ts=('(o: Note): number', 'let r = 0;', 'r ^= JSON.stringify(o).length + {i};', 'r'), go=('(o *Note) int64', 'var r int64', '{ b, _ := json.Marshal(o); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(note)')
row('json_stringify_wide_text', 'json_stringify_text, and the last character of the text is an arrow (U+2192)', group='JSON, await', heavy=1,
    ts=('(o: Note): number', 'let r = 0;', 'r ^= JSON.stringify(o).length + {i};', 'r'), go=('(o *Note) int64', 'var r int64', '{ b, _ := json.Marshal(o); r ^= int64(len(b)) + {i} }', 'r'), cc=None, call='x ^= F(wideNote)')
row('await_resolved', 'r ^= await p: a promise that is already resolved', group='JSON, await', heavy=1, isasync=True,
    ts=('(p: Promise<number>): Promise<number>', 'let r = 0;', 'r ^= await p;', 'r'), go=None, cc=None, call={'ts': 'x ^= await F(pr)'})
row('await_value', 'r ^= await v: a number, no promise', group='JSON, await', heavy=1, isasync=True,
    ts=('(v: number): Promise<number>', 'let r = 0;', 'r ^= await v;', 'r'), go=None, cc=None, call={'ts': 'x ^= await F(i)'})

row('async_call_await', 'r = await af(r): an async function that returns at once is called and awaited (Go: a plain call: a goroutine blocks where JavaScript awaits)', group='JSON, await', heavy=1, isasync=True,
    ts=('(r: number): Promise<number>', '', 'r = await af(r);', 'r'), go=('(r int64) int64', '', 'r = g1(r)', 'r'), cc=None, call={'ts': 'x = await F(x)', 'go': 'x = F(x)'})

def sites(form, n):
    out = []
    for i in range(n):
        out.append(form.replace('{i1}', str(i + 1)).replace('{i8}', str(i * 8)).replace('{aa}', 'a' + 'abcdefghijklmnop'[i]).replace('{i}', str(i)))
    return out

BULKN = 60
def bulk(fmt): return ' '.join(fmt % (i % 13 + 1, (i + 3) % 13 + 1, 2 * i + 3, (i + 7) % 13 + 1) for i in range(BULKN))
TSB = 'if (G15 > 1000000) { ' + bulk('G%d = ((G%d + %d) ^ G%d) | 0;') + ' } '
GOB = 'if G15 > 1000000 { ' + bulk('G%d = (G%d + %d) ^ G%d;') + ' }; '
CCB = 'if (G15 > 1000000) { ' + bulk('G%d = (G%d + %d) ^ G%d;') + ' } '

# ------------------------------------------------------------------ TypeScript
# Every top-level declaration is an item: (the names it defines, its text). A program holds the items that its rows reach, in this order.
ITEMS = []
def item(names, text): ITEMS.append((names.split(), text))
item('argv', 'const argv: string[] = process.argv;')
item('ROW COUNT LEN WORD VERB0 VERB1', 'const ROW: string = argv[2] ?? "", COUNT: number = parseInt(argv[3] ?? "0", 10) | 0, LEN: number = parseInt(argv[4] ?? "2", 10) | 0, WORD: string = argv[5] ?? "lit_zz", VERB0: string = argv[6] ?? "DELETE", VERB1: string = argv[7] ?? "PATCH";')
item(' '.join('G%d' % i for i in R16), 'let ' + ', '.join('G%d = (LEN + %d) | 0' % (i, i - 2) for i in R16) + ';')
item('fill', 'function fill(n: number, v: number): number[] { const r: number[] = []; for (let i = 0; i < n; ++i) r.push((v + i) | 0); return r; }')
item('T', 'class T {\n    next: T; nn: T | null; any: unknown; s: string; e: string; m: string;\n    ' + ' '.join('f%d: number; d%d: number; r%d: T; l%d: number[]; ss%d: string;' % ((i,) * 5) for i in R16)
          + '\n    constructor(seed: number, verb: string) {\n        this.next = this; this.nn = null; this.any = this; this.s = WORD.slice(0, 5) + (seed & 7); this.e = WORD.slice(0, 3) + WORD.slice(3); this.m = verb;\n        '
          + ' '.join('this.f%d = (seed + %d) | 0; this.d%d = seed + %d.5; this.r%d = this; this.l%d = fill(LEN, seed + %d); this.ss%d = "t%d" + seed;' % ((i,) * 9) for i in R16) + '\n    }\n}')
item('T2', 'class T2 { next: T2 | null; a: number; b: number; constructor(next: T2 | null, a: number) { this.next = next; this.a = a; this.b = 0; } }')
item('L2', 'interface L2 { next: L2 | null; a: number; b: number; }')
item('NI', 'interface NI { d: number; e: number; }')
item('NS', 'interface NS { next: NS; c: NI; f: number; }')
item('makeNS NS0', 'function makeNS(seed: number): NS { const n = { next: null as unknown as NS, c: { d: (seed + 1) | 0, e: (seed + 2) | 0 }, f: seed | 0 }; n.next = n; return n; }\nconst NS0: NS = makeNS(LEN), NS1: NS = makeNS(LEN + 1); NS0.next = NS1; NS1.next = NS0;')
item('takeNI', 'function takeNI(c: NI): number { ' + TSB + 'return c.d; }')
item('NL', 'interface NL { next: NL | null; c: NI; f: number; }')
item('AL', 'interface AL { next: AL | null; items: number[]; f: number; }')
item('ringA walkA', 'const ringA: (AL | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkA(): number { let r = 0; for (const h of ringA) for (let p = h; p !== null; p = p.next) r = (r + p.items.length + p.f) | 0; return r; }')
item('AC', 'class AC { next: AC | null; items: number[]; f: number; constructor(next: AC | null, f: number) { this.next = next; this.items = []; this.f = f; } }')
item('ringAC walkAC', 'const ringAC: (AC | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkAC(): number { let r = 0; for (const h of ringAC) for (let p = h; p !== null; p = p.next) r = (r + p.items.length + p.f) | 0; return r; }')
item('ringN walkN', 'const ringN: (NL | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkN(): number { let r = 0; for (const h of ringN) for (let p = h; p !== null; p = p.next) r = (r + p.c.d + p.c.e + p.f) | 0; return r; }')
item('NI2', 'class NI2 { d: number; e: number; constructor(d: number) { this.d = d; this.e = 0; } }')
item('NC', 'class NC { next: NC | null; c: NI2; f: number; constructor(next: NC | null, d: number) { this.next = next; this.c = new NI2(d); this.f = 0; } }')
item('ringNC walkNC', 'const ringNC: (NC | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkNC(): number { let r = 0; for (const h of ringNC) for (let p = h; p !== null; p = p.next) r = (r + p.c.d + p.c.e + p.f) | 0; return r; }')
item('Opt', 'class Opt {\n    next: Opt; ' + ' '.join('x%d?: number;' % i for i in R16) + '\n    constructor(seed: number, full: boolean) { this.next = this; if (full) { ' + ' '.join('this.x%d = (seed + %d) | 0;' % (i, i) for i in R16) + ' } }\n}')
item('HasV', 'interface HasV { other: HasV; ' + ' '.join('v%d: number;' % i for i in R16) + ' }')
item('V1', 'class V1 implements HasV {\n    pad: number; other: HasV; ' + ' '.join('v%d: number;' % i for i in R16) + '\n    constructor(seed: number) { this.pad = 0; this.other = this; ' + ' '.join('this.v%d = (seed + %d) | 0;' % (i, i) for i in R16) + ' }\n}')
item('V2', 'class V2 implements HasV {\n    ' + ' '.join('v%d: number;' % i for i in reversed(R16)) + ' other: HasV; tail: string;\n    constructor(seed: number) { ' + ' '.join('this.v%d = (seed + %d) | 0;' % (i, i) for i in reversed(R16)) + ' this.other = this; this.tail = "x"; }\n}')
item('Circle', 'class Circle { kind: "circle"; next: Shape; r: number; constructor(r: number) { this.kind = "circle"; this.next = this; this.r = r | 0; } }')
item('Square', 'class Square { kind: "square"; next: Shape; pad: number; s: number; constructor(s: number) { this.kind = "square"; this.next = this; this.pad = 0; this.s = s | 0; } }')
item('Shape', 'type Shape = Circle | Square;')
item('TU', 'class TU {\n    ' + ' '.join('u%d: string | number;' % i for i in R16) + '\n    constructor(seed: number) { ' + ' '.join('this.u%d = ((seed + %d) & 1) === 0 ? "u" + seed : seed + 1;' % (i, i) for i in R16) + ' }\n}')
item('Base D1 D2', 'class Base { z: number; constructor(z: number) { this.z = z; } }\nclass D1 extends Base { p1: number; constructor(z: number) { super(z); this.p1 = 1; } }\nclass D2 extends Base { p2: string; constructor(z: number) { super(z); this.p2 = "2"; } }')
item('TB', 'class TB {\n    ' + ' '.join('b%d: Base;' % i for i in R16) + '\n    constructor(seed: number) { ' + ' '.join('this.b%d = ((seed + %d) & 1) === 0 ? new D1(seed) : new D2(seed);' % (i, i) for i in R16) + ' }\n}')
def hidden(name, parent):
    return ('class %s%s {\n    ' % (name, ' extends ' + parent if parent else '') + ' '.join('#h%d: number; f%d: number;' % (i, i) for i in R16)
            + '\n    constructor(seed: number) { %s' % ('super("hidden"); ' if parent else '') + ' '.join('this.#h%d = (seed + %d) | 0; this.f%d = (seed + %d) | 0;' % (i, i, i, i + 1) for i in R16) + ' }\n    '
            + ' '.join('static g%d(o: %s): number { return o.#h%d; } static s%d(o: %s, v: number): void { o.#h%d = v; }' % (i, name, i, i, name, i) for i in R16) + '\n}')
item('PN', hidden('PN', None))
item('BP', hidden('BP', 'Error'))
item('I', 'interface I { M(a: number): number; }')
item('I1', 'class I1 implements I { k: number; constructor(k: number) { this.k = k; } M(a: number): number { ' + TSB + 'return (a + this.k) | 0; } }')
item('I2', 'class I2 implements I { j: string; k: number; constructor(k: number) { this.j = "j"; this.k = k; } M(a: number): number { ' + TSB + 'return (a + this.k + 1) | 0; } }')
item('K', 'class K { k: number; constructor(k: number) { this.k = k; } m(a: number): number { ' + TSB + 'return (a + this.k) | 0; } }')
item('KF', 'class KF { k: number; constructor(k: number) { this.k = k; } m(a: number): number { ' + TSB + 'return (a + this.k) | 0; } }\nObject.freeze(KF.prototype);')
item('WithGetter', 'class WithGetter { n: number; constructor(n: number) { this.n = n | 0; } get size(): number { return this.n; } }')
item('wA wB', 'const wA = new WithGetter(LEN), wB = new WithGetter(LEN + 1);')
item('P3', 'interface P3 { a: number; b: number; c: number; }')
item('ring4 walk4', 'const ring4: P3[] = []; for (let i = 0; i < 8; ++i) ring4.push({ a: i + LEN, b: i, c: LEN });\nfunction walk4(): number { let r = 0; for (const p of ring4) r = (r + p.a + p.b + p.c) | 0; return r; }')
item('bytes', 'const bytes = new Uint8Array(64); for (let i = 0; i < 64; ++i) bytes[i] = (i * 7 + 1) & 31;')
item('af', 'async function af(a: number): Promise<number> { ' + TSB + 'return (a + G0) | 0; }')
item('Rec', 'interface Rec { id: number; name: string; ok: boolean; tags: string[]; }')
item('g1', 'function g1(a: number): number { ' + TSB + 'return (a + G0) | 0; }')
item('h1', 'function h1(a: number): number { ' + TSB + 'return (a + G1) | 0; }')
item('g3', 'function g3(a: number, b: number, c: number): number { ' + TSB + 'return (a + b + c + G0) | 0; }')
item('gs', 'function gs(s: string, a: number): number { ' + TSB + 'return (a + s.length + G0) | 0; }')
item('gi', 'function gi(s: string): string { ' + TSB + 'return s; }')
item('makeClosure', 'function makeClosure(k: number): (a: number) => number { return (a: number): number => { ' + TSB + 'return (a + k) | 0; }; }')
for j, tail in enumerate(TAILS):
    item('arrow%d' % (j + 1), 'function arrow%d(k: number): (a: number) => number { return (a: number): number => { ' % (j + 1) + TSB + 'return (%s) | 0; }; }' % tail)
item('makeBig', 'function makeBig(k: number): (a: number) => number { return (a: number): number => { ' + WORK_TS + ' return a; }; }')
item('Holder', 'class Holder { next: Holder; f: (a: number) => number; constructor(f: (a: number) => number) { this.next = this; this.f = f; } }')
item('A0 A1', 'const A0 = new T(LEN - 1, VERB0), A1 = new T(LEN, VERB1); A0.next = A1; A1.next = A0; A0.nn = A1; A1.nn = A0; A0.any = A1; A1.any = A0; A0.f0 = LEN - 2; A1.f0 = LEN - 1;')
item('nodes', 'const nodes: T[] = [A0, A1, A0, A1];')
item('LS', 'const LS: string[][] = []; for (let i = 0; i < 16; ++i) LS.push([]);')
item('LJ', 'const LJ: string[][] = []; for (let i = 0; i < 16; ++i) LJ.push([WORD, "t" + i, VERB0]);')
item('KV', 'interface KV { k: number; v: number }')
item('LR', 'const LR: KV[][] = []; for (let i = 0; i < 16; ++i) LR.push([]);')
item('O0 O1', 'const O0 = new Opt(LEN, LEN > 0), O1 = new Opt(LEN + 1, LEN > 0); O0.next = O1; O1.next = O0;')
item('OE0 OE1', 'const OE0 = new Opt(LEN, LEN < 0), OE1 = new Opt(LEN + 1, LEN < 0); OE0.next = OE1; OE1.next = OE0;')
item('H0 H1', 'const H0: HasV = new V1(LEN), H1: HasV = new V2(LEN + 1); H0.other = H1; H1.other = H0;')
item('U0 U1', 'const U0: Shape = new Circle(LEN), U1: Shape = new Square(LEN + 1); U0.next = U1; U1.next = U0;')
item('UU0', 'const UU0 = new TU(LEN);')
item('BB0', 'const BB0 = new TB(LEN);')
item('numbers', 'const numbers: number[] = []; for (let i = 0; i < 64; ++i) numbers.push((i * 7 + 1) & 31);')
item('codes', 'let codes = ""; for (let i = 0; i < 64; ++i) codes += String.fromCharCode((i * 7 + 1) & 31); codes = codes.slice(0, 32) + codes.slice(32); if (codes.charCodeAt(3) < 0) G0 = 1;')
item('longs', 'const longs: string = WORD.repeat(16);')
item('repeated', 'const repeated: string = WORD.repeat(LEN);')
item('W0 W1', 'const W0: string = WORD.slice(1), W1: string = WORD.slice(2);')
item('keys', 'const keys: string[] = []; for (let i = 0; i < 16; ++i) keys.push(WORD + i);')
item('table K0', 'const table = new Map<string, string>(); for (let i = 0; i < 16; ++i) table.set(keys[i], keys[(i + 1) & 15]); const K0: string = keys[0];')
item('itable', 'const itable = new Map<number, number>(); for (let i = 0; i < 64; ++i) itable.set(i, (i * 7 + 1) & 63);')
ALLSS = '[' + ', '.join('p.ss%d' % i for i in R16) + ']'
item('ntable', 'const ntable = new Map<string, number>(); for (const p of [A0, A1]) for (const k of ' + ALLSS + ') ntable.set(k, k.length);')
item('sset', 'const sset = new Set<string>(); for (const p of [A0, A1]) for (const k of ' + ALLSS + ') sset.add(k);')
item('dict', 'const dict: Record<string, number> = {}; for (const p of [A0, A1]) for (const k of ' + ALLSS + ') dict[k] = k.length;')
item('bag', 'const bag: any = {}; for (let i = 0; i < 16; ++i) bag["literal" + i] = i + LEN;')
item('cA cB', 'const cA = makeClosure(LEN), cB = makeClosure(LEN + 1);')
item('two', 'const two: ((a: number) => number)[] = [' + sixteen(2, 'arrow%d(%s)') + '];')
item('many', 'const many: ((a: number) => number)[] = [' + sixteen(ARROWS, 'arrow%d(%s)') + '];')
item('bigA bigB', 'const bigA = makeBig(LEN), bigB = makeBig(LEN + 1);')
item('holders HO0', 'const holders: Holder[] = []; for (let i = 0; i < 16; ++i) holders.push(new Holder(many[i])); for (let i = 0; i < 16; ++i) holders[i].next = holders[(i + 1) & 15];\nconst HO0: Holder = holders[0];')
item('kA kB', 'const kA = new K(LEN), kB = new K(LEN + 1);')
item('kfA kfB', 'const kfA = new KF(LEN), kfB = new KF(LEN + 1);')
item('pnA', 'const pnA = new PN(LEN);')
item('bpA', 'const bpA = new BP(LEN);')
item('TW', 'class TW {\n    own: number; lanes: number; ' + ' '.join('t%d: any;' % i for i in R16) + '\n    constructor(seed: number) { this.own = seed | 0; this.lanes = (seed + 1) | 0; ' + ' '.join('this.t%d = null;' % i for i in R16) + ' }\n}')
item('sharedOthers', 'const sharedOthers: any[] = [];\nfunction makeSharedOthers(k: number): void { sharedOthers.push({ pending: k, lanes: k }, { lanes: k, first: k }, { left: k, right: k, lanes: k }, { name: "w", width: k, length: k, lanes: k }); }\nfor (let i = 0; i < 16; ++i) makeSharedOthers(i);')
item('twA', 'const twA = new TW(LEN), twB = new TW(LEN + sharedOthers.length); ' + ' '.join('twA.t%d = twB;' % i for i in R16))
item('iA iB', 'const iA: I = new I1(LEN), iB: I = new I2(LEN);')
item('bA bB', 'const bA = kA.m.bind(kA), bB = kB.m.bind(kB);')
item('TP', 'class TP { #next: TP | null; #a: number; #b: number; constructor(next: TP | null, a: number) { this.#next = next; this.#a = a; this.#b = 0; } static sum(h: TP | null): number { let r = 0; for (let p = h; p !== null; p = p.#next) r = (r + p.#a + p.#b) | 0; return r; } }')
item('TD', 'class TD { #next: TD | null; #a = 1; #b = 0; constructor(next: TD | null, a: number) { this.#next = next; this.#a = a; } static sum(h: TD | null): number { let r = 0; for (let p = h; p !== null; p = p.#next) r = (r + p.#a + p.#b) | 0; return r; } }')
item('TQ', 'class TQ { #next: TQ | null; #a: number; #b: number; constructor(next: TQ | null, a: number) { this.#next = next; this.#a = a; this.#b = 0; } static sum(h: TQ | null): number { let r = 0; for (let p = h; p !== null; p = p.#next) r = (r + p.#a + p.#b) | 0; return r; } }')
item('unknownCode', 'const unknownCode = new Function("x", argv[9] ?? "return x") as <V>(value: V) => V;')
item('ringP walkP', 'const ringP: (TP | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkP(): number { let r = 0; for (const h of ringP) r = (r + TP.sum(h)) | 0; return r; }')
item('ringD walkD', 'const ringD: (TD | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkD(): number { let r = 0; for (const h of ringD) r = (r + TD.sum(h)) | 0; return r; }')
item('ringQ walkQ', 'const ringQ: (TQ | null)[] = [null, null, null, null, null, null, null, null];\nfunction walkQ(): number { let r = 0; for (const h of ringQ) r = (r + TQ.sum(h)) | 0; return r; }\nunknownCode(new TQ(null, 0));')
item('Host', 'class Host { name = "host"; }')
item('PG', 'class PG {\n    ' + ' '.join('#h%d: number;' % i for i in R16) + '\n    constructor(seed: number) { ' + ' '.join('this.#h%d = (seed + %d) | 0;' % (i, i) for i in R16) + ' }\n    ' + ' '.join('m%d(h: Host): number { return this.#h%d ^ h.name.length; }' % (i, i) for i in R16) + '\n}')
item('pgA noHost', 'const pgA = unknownCode(new PG(LEN));\nconst noHost = JSON.parse(\'{"name":"no","more":1}\') as Host;')
item('ring2 walk2', 'const ring2: (T2 | null)[] = [null, null, null, null, null, null, null, null];\nfunction walk2(): number { let r = 0; for (const h of ring2) for (let p = h; p !== null; p = p.next) r = (r + p.a + p.b) | 0; return r; }')
item('ring3 walk3', 'const ring3: (L2 | null)[] = [null, null, null, null, null, null, null, null];\nfunction walk3(): number { let r = 0; for (const h of ring3) for (let p = h; p !== null; p = p.next) r = (r + p.a + p.b) | 0; return r; }')
item('z0 sinkf', 'const z0 = (): number => G0; let sinkf: () => number = z0;')
item('rec', 'const rec: Rec = { id: LEN + 1000, name: WORD + "-name", ok: LEN > 0, tags: [WORD, VERB0] };')
item('text', 'const text: string = JSON.stringify(rec);')
item('Rec2', 'interface Rec2 { head: Rec; tail: Rec; label: string; }')
item('rec2', 'const rec2: Rec2 = { head: rec, tail: { id: LEN, name: WORD, ok: LEN < 0, tags: [] }, label: WORD };')
item('recs', 'const recs: Rec[] = []; for (let i = 0; i < 8; ++i) recs.push({ id: LEN + i, name: WORD + i, ok: (i & 1) === 0, tags: [WORD, VERB0] });')
item('recAny', 'const recAny: any = JSON.parse(text);')
item('Note', 'interface Note { role: string; text: string; }')
item('lines', 'function lines(): string { let t = ""; for (let i = 0; t.length < 2000; ++i) t += "line " + (LEN + i) + " of \\"" + WORD + "\\" with a tab\\tand an end\\n"; return t; }')
item('note wideNote', 'const note: Note = { role: VERB0, text: lines() }, wideNote: Note = { role: VERB0, text: lines() + "\\u2192" };')
item('pr', 'const pr: Promise<number> = Promise.resolve(LEN);')
NEST = ('    let text: string = initial; ' + ' '.join('let c%d: number = (seed + %d) | 0;' % (i, i) for i in R16)
        + '\n    function set(t: string, v: number): void { text = t; ' + ' '.join('c%d = (c%d + v) | 0;' % (i, i) for i in R16) + ' }'
        + '\n    function sum(): number { return (text.length ^ ' + ' ^ '.join('c%d' % i for i in R16) + ') | 0; }'
        + '\n    function inner(a: number): number { ' + TSB + 'return (a + c0) | 0; }')
WORDS = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
# The opened programs: the same texts, but every object, array, table, closure and string that the rows work on has been handed to evaluated text and has come back from it,
# so the whole-program analysis runs with all its passes and cannot say what the values are: the state of most accesses of a large program.
# The text is not a constant of the program: a constant text is compiled with the program and flow sees through it (RUN 14:04: every row came out as proven).
LAUNDER = 'const launder = new Function("v", "return v" + WORD.slice(WORD.length)) as <V>(v: V) => V;'
def split0(text, mark):
    out = []; depth = 0; quote = None; cur = ''
    for k, c in enumerate(text):
        if quote:
            cur += c
            if c == quote and text[k - 1] != '\\': quote = None
            continue
        if c in '"\'`': quote = c
        elif c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        if c == mark and depth == 0: out.append(cur); cur = ''
        else: cur += c
    out.append(cur); return out
def opened(names, text):
    if not text.startswith(('const ', 'let ')) or names[0] in ('argv', 'ROW', 'G0'): return text
    head, sep, tail = text.partition('\nfunction ')
    head = re.sub(r'<[A-Za-z0-9_ ,|\[\]]+>', lambda m: m.group(0).replace(',', '\x00'), head)
    out = []; again = []
    for st in split0(head, ';'):
        t = st.strip()
        if not t: continue
        if t.startswith(('const ', 'let ')):
            kw, rest = t.split(' ', 1); decls = []
            for d in split0(rest, ','):
                k = next(i for i, c in enumerate(d) if c == '=' and d[i + 1] not in '=>' and d[i - 1] not in '=<>!')
                decls.append(d[:k].strip() + ' = launder(' + d[k + 1:].strip() + ')')
                if kw == 'let': again.append(re.match(r'\s*([A-Za-z0-9_$]+)', d).group(1))
            out.append(kw + ' ' + ', '.join(decls))
        else: out.append(t)
    out += ['%s = launder(%s)' % (n, n) for n in again]
    return ('; '.join(out) + ';').replace('\x00', ',') + sep + tail
def program(rows, isopen=False):
    body = []; names = []
    for r in rows:
        sig, pre, site, ret = r['ts']; inner = []
        for n in N:
            f = '%s_%d' % (r['name'], n); names.append((f, r['isasync']))
            (inner if r['nested'] else body).append('%sfunction %s%s {\n    %s\n%s    %s\n    %s\n}' % ('async ' if r['isasync'] else '', f, sig, TSB, '    ' + pre + '\n' if pre else '', '\n    '.join(sites(site, n)), 'return %s;' % ret if ret else ''))
            if r['nested'] and n == N[-1]:
                body.append(('function make_%s(initial: string, seed: number) {\n%s\n%s\n    return { set, sum, f%d: %s_%d, f%d: %s_%d };\n}\n' + ('const %s_A = launder(make_%s(codes, LEN)), %s_B = launder(make_%s(codes, LEN + 1));' if isopen else 'const %s_A = make_%s(codes, LEN), %s_B = make_%s(codes, LEN + 1);'))
                            % (r['name'], NEST, '\n'.join(inner), N[0], r['name'], N[0], N[1], r['name'], N[1], r['name'], r['name'], r['name'], r['name']))
            body.append('%sfunction drive_%s(n: number): %s {\n    let a: T = A0, x = LEN | 0, y = 0.5; %s\n    for (let i = 0; i < n; ++i) { %s; a = a.next; }\n    return (x ^ a.f0 ^ (y | 0)%s) | 0;\n}'
                        % ('async ' if r['isasync'] else '', f, 'Promise<number>' if r['isasync'] else 'number', r['extra']['ts'], r['call']['ts'].replace('F(', ('f%d(' % n) if r['nested'] else f + '('), r['final']['ts']))
    tail = []
    sync = [f for f, a in names if not a]; asy = [f for f, a in names if a]
    if sync: tail.append('const rows = new Map<string, (n: number) => number>([' + ', '.join('["%s", drive_%s]' % (f, f) for f in sync) + ']);\nconst chosen = rows.get(ROW);')
    if asy: tail.append('const asyncRows = new Map<string, (n: number) => Promise<number>>([' + ', '.join('["%s", drive_%s]' % (f, f) for f in asy) + ']);\nconst chosenAsync = asyncRows.get(ROW);')
    tail.append(('if (chosen !== undefined) console.log(ROW, chosen(COUNT)); else ' if sync else '') + ('if (chosenAsync !== undefined) chosenAsync(COUNT).then((v: number): void => { console.log(ROW, v); }); else ' if asy else '') + 'console.log("no row", ROW);')
    items = [(d, opened(d, t)) for d, t in ITEMS] if isopen else ITEMS
    used = set(WORDS.findall('\n'.join(body + tail + ([LAUNDER] if isopen else [])))); take = [False] * len(items); more = True
    while more:
        more = False
        for k, (defs, text) in enumerate(items):
            if not take[k] and any(d in used for d in defs): take[k] = True; used |= set(WORDS.findall(text)); more = True
    return '\n'.join([t + ('\n' + LAUNDER if isopen and 'WORD' in d else '') for k, (d, t) in enumerate(items) if take[k]] + body + tail) + '\n'
tsrows = [r for r in ROWS if r['ts'] and r['name'] not in SKIP]
open(W + '/typed.ts', 'w').write(program(tsrows))
for r in tsrows: open(W + '/alone/%s.ts' % r['name'], 'w').write(program([r]))
os.makedirs(W + '/opened', exist_ok=True)
for r in tsrows: open(W + '/opened/%s.ts' % r['name'], 'w').write(program([r], True))

# ------------------------------------------------------------------ Go
go = ['package main', 'import ("encoding/json"; "errors"; "fmt"; "math"; "os"; "regexp"; "slices"; "strconv"; "strings")']
go.append('type T struct { next *T; nn *T; any any; s, e, m string; f [16]int64; d [16]float64; r [16]*T; l [16][]int64; ss [16]string }')
go.append('type NI struct { d, e int64 }\ntype NS struct { next *NS; c NI; f int64 }\ntype NL struct { next *NL; c NI; f int64 }\ntype AL struct { next *AL; items []int64; f int64 }\nvar NS0 *NS; var sinkN *NL; var sinkA *AL\n//go:noinline\nfunc takeNI(c *NI) int64 { ' + GOB + 'return c.d }')
go.append('type KV struct { k, v int64 }\nvar LS, LJ [16][]string; var LR [16][]KV')
go.append('type T2 struct { next *T2; a, b int64 }\ntype OptInt struct { v int64; ok bool }\ntype Opt struct { next *Opt; x [16]OptInt }')
go.append('type HasV interface { Other() HasV; ' + '; '.join('V%d() int64' % i for i in R16) + ' }')
go.append('type V1 struct { pad int64; other HasV; v [16]int64 }\ntype V2 struct { v [16]int64; other HasV; tail string }')
for t in ('V1', 'V2'):
    go.append('func (h *%s) Other() HasV { return h.other }\n' % t + '\n'.join('func (h *%s) V%d() int64 { return h.v[%d] }' % (t, i, i) for i in R16))
go.append('type Shape interface { isShape() }\ntype Circle struct { next Shape; r int64 }\ntype Square struct { next Shape; pad, s int64 }\nfunc (*Circle) isShape() {}\nfunc (*Square) isShape() {}')
go.append('type TU struct { u [16]any }\ntype BaseI interface { Z() int64 }\ntype D1 struct { z, p1 int64 }\ntype D2 struct { z int64; p2 string }\nfunc (d *D1) Z() int64 { return d.z }\nfunc (d *D2) Z() int64 { return d.z }\ntype TB struct { b [16]BaseI }')
go.append('type I interface { M(int64) int64 }\ntype I1 struct { k int64 }\ntype I2 struct { j string; k int64 }\ntype K struct { k int64 }')
go.append('type WithGetter struct { n int64 }\nfunc (o *WithGetter) Size() int64 { return o.n }\ntype P3 struct { a, b, c int64 }\nvar wg [2]*WithGetter; var p3 P3; var bytes []byte; var sinkl []int64; var re1 = regexp.MustCompile(`^t\\d+$`); var re2 = regexp.MustCompile(`^t(\\d+)$`); var re3 = regexp.MustCompile(`\\d+`); var errX = errors.New("x")')
go.append('type Rec struct { Id int64 `json:"id"`; Name string `json:"name"`; Ok bool `json:"ok"`; Tags []string `json:"tags"` }')
go.append('type Lit struct { Id int64 `json:"id"`; Name string `json:"name"`; Ok bool `json:"ok"` }\ntype Rec2 struct { Head *Rec `json:"head"`; Tail *Rec `json:"tail"`; Label string `json:"label"` }\ntype Note struct { Role string `json:"role"`; Text string `json:"text"` }\nvar rec2 *Rec2; var recs []*Rec; var recAny any; var note, wideNote *Note')
go.append('var ' + ', '.join('G%d' % i for i in R16) + ' int64')
go.append('//go:noinline\nfunc (o *I1) M(a int64) int64 { ' + GOB + 'return a + o.k }\n//go:noinline\nfunc (o *I2) M(a int64) int64 { ' + GOB + 'return a + o.k + 1 }\n//go:noinline\nfunc (o *K) m(a int64) int64 { ' + GOB + 'return a + o.k }')
go.append('//go:noinline\nfunc g1(a int64) int64 { ' + GOB + 'return a + G0 }\n//go:noinline\nfunc h1(a int64) int64 { ' + GOB + 'return a + G1 }\n//go:noinline\nfunc g3(a, b, c int64) int64 { ' + GOB + 'return a + b + c + G0 }')
go.append('//go:noinline\nfunc gs(s string, a int64) int64 { ' + GOB + 'return a + int64(len(s)) + G0 }\n//go:noinline\nfunc gi(s string) string { ' + GOB + 'return s }')
go.append('type Cap struct { text string; c [16]int64 }\nvar caps [2]*Cap\n//go:noinline\nfunc capSet(s *Cap, t string, v int64) { s.text = t; for i := range s.c { s.c[i] += v } }\n//go:noinline\nfunc capSum(s *Cap) int64 { r := int64(len(s.text)); for _, v := range s.c { r ^= v }; return r }\n//go:noinline\nfunc capInner(s *Cap, a int64) int64 { ' + GOB + 'return a + s.c[0] }')
go.append('func makeClosure(k int64) func(int64) int64 { return func(a int64) int64 { ' + GOB + 'return a + k } }')
for j, tail in enumerate(TAILS):
    go.append('func arrow%d(k int64) func(int64) int64 { return func(a int64) int64 { ' % (j + 1) + GOB + 'return %s } }' % tail)
go.append('func makeBig(k int64) func(int64) int64 { return func(a int64) int64 { ' + WORK_GO + '; return a } }')
go.append('type Holder struct { next *Holder; f func(int64) int64 }\nvar two, many []func(int64) int64; var bigs [2]func(int64) int64; var HO0 *Holder')
go.append('var A0, A1 *T; var nodes []*T; var O0 *Opt; var H0 HasV; var U0 Shape; var UU0 *TU; var BB0 *TB; var numbers []int64; var codes, longs, repeated, W0, W1, WORD, K0 string; var table map[string]string; var itable map[int64]int64; var ntable map[string]int64; var sset map[string]struct{}; var bag map[string]int64')
go.append('var fs, cs, bs [2]func(int64) int64; var ks [2]*K; var is [2]I; var sink2 *T2; var sinkf func() int64; var z0 func() int64; var rec *Rec; var textb []byte; var LEN int64')
gonames = []
for r in ROWS:
    if not r['go']: continue
    sig, pre, site, ret = r['go']
    for n in N:
        f = '%s_%d' % (r['name'], n); gonames.append(f)
        go.append('//go:noinline\nfunc %s%s {\n%s\t%s\n\t%s\n}' % (f, sig, '\t' + pre + '\n' if pre else '', '\n\t'.join(sites(site, n)), 'return ' + ret if ret else ''))
        go.append('func drive_%s(n int64) int64 {\n\ta := A0; x := LEN; y := 0.5; %s\n\tfor i := int64(0); i < n; i++ { %s; a = a.next }\n\treturn x ^ a.f[0] ^ int64(y)%s\n}' % (f, r['extra']['go'], r['call']['go'].replace('F(', f + '('), r['final']['go']))
go.append('''func newT(seed int64, verb string) *T {
	t := &T{}; t.next = t; t.any = t; t.s = WORD[:5] + strconv.FormatInt(seed & 7, 10); t.e = strings.Clone(WORD); t.m = verb
	for i := int64(0); i < 16; i++ { t.f[i] = seed + i; t.d[i] = float64(seed + i) + 0.5; t.r[i] = t; for j := int64(0); j < LEN; j++ { t.l[i] = append(t.l[i], seed + i + j) }; t.ss[i] = "t" + strconv.FormatInt(i, 10) + strconv.FormatInt(seed, 10) }
	return t
}
func main() {
	row := os.Args[1]; count, _ := strconv.ParseInt(os.Args[2], 10, 64); LEN, _ = strconv.ParseInt(os.Args[3], 10, 64); WORD = os.Args[4]
''' + '\n'.join('\tG%d = LEN + %d' % (i, i - 2) for i in R16) + '''
	A0 = newT(LEN - 1, os.Args[5]); A1 = newT(LEN, os.Args[6]); A0.next = A1; A1.next = A0; A0.nn = A1; A1.nn = A0; A0.any = A1; A1.any = A0
	nodes = []*T{A0, A1, A0, A1}; A0.f[0] = LEN - 2; A1.f[0] = LEN - 1
	NS0 = &NS{c: NI{LEN + 1, LEN + 2}, f: LEN}; ns1 := &NS{c: NI{LEN + 2, LEN + 3}, f: LEN + 1}; NS0.next = ns1; ns1.next = NS0
	O0 = &Opt{}; O1 := &Opt{}; O0.next = O1; O1.next = O0; for i := int64(0); i < 16; i++ { O0.x[i] = OptInt{LEN + i, LEN > 0}; O1.x[i] = OptInt{LEN + 1 + i, LEN > 0} }
	hv0 := &V1{}; hv1 := &V2{}; hv0.other = hv1; hv1.other = hv0; for i := int64(0); i < 16; i++ { hv0.v[i] = LEN + i; hv1.v[i] = LEN + 1 + i }; H0 = hv0
	u0 := &Circle{r: LEN}; u1 := &Square{s: LEN + 1}; u0.next = u1; u1.next = u0; U0 = u0
	UU0 = &TU{}; BB0 = &TB{}; for i := 0; i < 16; i++ { if i % 2 == 0 { UU0.u[i] = "u" + os.Args[3]; BB0.b[i] = &D1{z: LEN} } else { UU0.u[i] = LEN + 1; BB0.b[i] = &D2{z: LEN} } }
	cb := make([]byte, 64); for i := 0; i < 64; i++ { numbers = append(numbers, int64((i * 7 + 1) & 31)); cb[i] = byte((i * 7 + 1) & 31) }; codes = string(cb)
	longs = strings.Repeat(WORD, 16); repeated = strings.Repeat(WORD, int(LEN)); W0 = WORD[1:]; W1 = WORD[2:]
	keys := make([]string, 16); for i := range keys { keys[i] = WORD + strconv.Itoa(i) }; table = map[string]string{}; for i := range keys { table[keys[i]] = keys[(i + 1) & 15] }; K0 = keys[0]
	itable = map[int64]int64{}; for i := int64(0); i < 64; i++ { itable[i] = (i * 7 + 1) & 63 }
	for i := range LJ { LJ[i] = []string{WORD, "t" + strconv.Itoa(i), os.Args[5]} }
	ntable = map[string]int64{}; sset = map[string]struct{}{}; for _, p := range []*T{A0, A1} { for _, k := range p.ss { ntable[k] = int64(len(k)); sset[k] = struct{}{} } }
	bag = map[string]int64{}; for i := int64(0); i < 16; i++ { bag["literal" + strconv.FormatInt(i, 10)] = i + LEN }
	fs = [2]func(int64) int64{g1, h1}; cs = [2]func(int64) int64{makeClosure(LEN), makeClosure(LEN + 1)}; ks = [2]*K{{LEN}, {LEN + 1}}; is = [2]I{&I1{LEN}, &I2{"j", LEN}}; bs = [2]func(int64) int64{ks[0].m, ks[1].m}
	z0 = func() int64 { return G0 }; sinkf = z0
	two = []func(int64) int64{''' + sixteen(2, 'arrow%d(%s)') + '''}; many = []func(int64) int64{''' + sixteen(ARROWS, 'arrow%d(%s)') + '''}; bigs = [2]func(int64) int64{makeBig(LEN), makeBig(LEN + 1)}
	ho := [16]*Holder{}; for j := range ho { ho[j] = &Holder{f: many[j]} }; for j := range ho { ho[j].next = ho[(j + 1) & 15] }; HO0 = ho[0]
	for j := range caps { caps[j] = &Cap{text: codes}; for i := range caps[j].c { caps[j].c[i] = LEN + int64(j) + int64(i) } }
	wg = [2]*WithGetter{{LEN}, {LEN + 1}}; p3 = P3{LEN, 1, LEN}; bytes = make([]byte, 64); for i := range bytes { bytes[i] = byte((i * 7 + 1) & 31) }
	rec = &Rec{LEN + 1000, WORD + "-name", LEN > 0, []string{WORD, os.Args[5]}}; textb, _ = json.Marshal(rec)
	rec2 = &Rec2{rec, &Rec{LEN, WORD, LEN < 0, []string{}}, WORD}; for i := int64(0); i < 8; i++ { recs = append(recs, &Rec{LEN + i, WORD + strconv.FormatInt(i, 10), i & 1 == 0, []string{WORD, os.Args[5]}}) }; json.Unmarshal(textb, &recAny)
	lines := ""; for i := int64(0); len(lines) < 2000; i++ { lines += "line " + strconv.FormatInt(LEN + i, 10) + " of \\"" + WORD + "\\" with a tab\\tand an end\\n" }; note = &Note{os.Args[5], lines}; wideNote = &Note{os.Args[5], lines + "\\u2192"}
	rows := map[string]func(int64) int64{''' + ', '.join('"%s": drive_%s' % (f, f) for f in gonames) + '''}
	if f, ok := rows[row]; ok { fmt.Println(row, f(count)) } else { fmt.Println("no row", row, sink2 == nil) }
}''')
open(W + '/main.go', 'w').write('\n'.join(go) + '\n'); open(W + '/go.mod', 'w').write('module main\ngo 1.25\n')

# ------------------------------------------------------------------ C++
h = ['#pragma once', '#include <string>', '#include <string_view>', '#include <vector>', '#include <unordered_map>', '#include <unordered_set>', '#include <optional>', '#include <variant>', '#include <functional>', '#include <algorithm>\n#include <cmath>', '#include <regex>', '#include <stdexcept>']
h.append('struct T { T* next; T* nn; std::string s, e, m; long f[16]; double d[16]; T* r[16]; std::vector<long> l[16]; std::string ss[16]; };')
h.append('struct NI { long d, e; };\nstruct NS { NS* next; NI c; long f; };\nstruct NL { NL* next; NI c; long f; };\nstruct AL { AL* next; std::vector<long> items; long f; };\nlong takeNI(NI*);')
h.append('struct KV { long k, v; };\nextern std::vector<std::string_view> LS[16]; extern std::vector<std::string> LJ[16]; extern std::vector<KV> LR[16];')
h.append('struct T2 { T2* next; long a, b; };\nstruct Opt { Opt* next; std::optional<long> x[16]; };\nstruct HV { HV* other; long v[16]; };\nstruct Shape { int kind; Shape* next; long r; long pad; long s; };')
h.append('struct TU { std::variant<std::string, long> u[16]; };\nstruct Base { long z; virtual ~Base(); };\nstruct D1 : Base { long p1; };\nstruct D2 : Base { std::string p2; };\nstruct TB { Base* b[16]; };')
h.append('struct V { virtual long M(long) = 0; };\nstruct K { long k; long m(long); };\nstruct B { virtual ~B(); };\nstruct D : B { B* other; };')
h.append('struct Holder { Holder* next; std::function<long(long)> f; };')
h.append('struct WithGetter { long n; long size() const { return n; } };\nstruct P3 { long a, b, c; };\nextern std::regex re1;')
h.append('extern long ' + ', '.join('G%d' % i for i in R16) + ';')
h.append('struct Cap { std::string text; long c[16]; };\nvoid capSet(Cap*, const std::string&, long); long capSum(Cap*); long capInner(Cap*, long);')
h.append('long g1(long); long h1(long); long g3(long, long, long); long gs(std::string_view, long); std::string gi(std::string);')
rc = ['#include "kit.h"']; mc = ['#include "kit.h"', '#include <cstdio>', '#include <cstdlib>', '#include <cstring>', '#include <map>']
ccnames = []
for r in ROWS:
    if not r['cc']: continue
    sig, pre, site, ret = r['cc']
    for n in N:
        f = '%s_%d' % (r['name'], n); ccnames.append(f)
        h.append(sig % f + ';')
        rc.append('%s {\n%s    %s\n    %s\n}' % (sig % f, '    ' + pre + '\n' if pre else '', '\n    '.join(sites(site, n)), 'return %s;' % ret if ret else ''))
mc.append('long ' + ', '.join('G%d' % i for i in R16) + ';')
mc.append('std::vector<std::string_view> LS[16]; std::vector<std::string> LJ[16]; std::vector<KV> LR[16];')
mc.append('Base::~Base() {} B::~B() {}\nstd::regex re1("^t\\\\d+$"); static WithGetter* wg[2]; static P3 p3; static std::vector<unsigned char> bytes;')
mc.append('struct I1 : V { long k; long M(long a) override { ' + CCB + 'return a + k; } };\nstruct I2 : V { std::string j; long k; long M(long a) override { ' + CCB + 'return a + k + 1; } };\nlong K::m(long a) { ' + CCB + 'return a + k; }')
mc.append('static Cap* caps[2];\nvoid capSet(Cap* s, const std::string& t, long v) { s->text = t; for (long& c : s->c) c += v; }\nlong capSum(Cap* s) { long r = s->text.size(); for (long c : s->c) r ^= c; return r; }\nlong capInner(Cap* s, long a) { ' + CCB + 'return a + s->c[0]; }')
mc.append('long g1(long a) { ' + CCB + 'return a + G0; }\nlong h1(long a) { ' + CCB + 'return a + G1; }\nlong g3(long a, long b, long c) { ' + CCB + 'return a + b + c + G0; }\nlong gs(std::string_view s, long a) { ' + CCB + 'return a + (long)s.size() + G0; }\nstd::string gi(std::string s) { ' + CCB + 'return s; }')
mc.append('static T *A0, *A1; static std::vector<T*> nodes; static Opt* O0; static HV* H0; static Shape* U0; static TU* UU0; static TB* BB0; static B* BD0; static std::vector<long> numbers; static std::string codes, longs, repeated, W0, W1, WORD; static const std::string* K0;')
mc.append('static std::unordered_map<std::string, const std::string*> table; static std::unordered_map<long, long> itable; static std::unordered_map<std::string, long> ntable; static std::unordered_set<std::string> sset; static std::unordered_map<std::string_view, long> bag;')
mc.append('static std::vector<std::function<long(long)>> two, many; static std::function<long(long)> bigs[2]; static Holder* HO0;')
for j, tail in enumerate(TAILS):
    mc.append('static std::function<long(long)> arrow%d(long k) { return [k](long a) { ' % (j + 1) + CCB + 'return %s; }; }' % tail)
mc.append('static std::function<long(long)> makeBig(long k) { return [k](long a) { ' + WORK_CC + ' return a; }; }')
mc.append('static NS* NS0; static NL* sinkN; static AL* sinkA;\nlong takeNI(NI* c) { ' + CCB + 'return c->d; }')
mc.append('static long (*fs[2])(long) = {g1, h1}; static std::function<long(long)> cs[2], bs[2]; static K* ks[2]; static V* is[2]; static T2* sink2; static long LEN;')
for r in ROWS:
    if not r['cc']: continue
    for n in N:
        f = '%s_%d' % (r['name'], n)
        mc.append('static long drive_%s(long n) {\n    T* a = A0; long x = LEN; double y = 0.5; %s\n    for (long i = 0; i < n; ++i) { %s; a = a->next; }\n    return x ^ a->f[0] ^ (long)y%s;\n}' % (f, r['extra']['cc'], r['call']['cc'].replace('F(', f + '('), r['final']['cc']))
mc.append('''static T* newT(long seed, const char* verb) {
    T* t = new T(); t->next = t; t->nn = nullptr; t->s = WORD.substr(0, 5) + std::to_string(seed & 7); t->e = WORD; t->m = verb;
    for (long i = 0; i < 16; ++i) { t->f[i] = seed + i; t->d[i] = seed + i + 0.5; t->r[i] = t; for (long j = 0; j < LEN; ++j) t->l[i].push_back(seed + i + j); t->ss[i] = "t" + std::to_string(i) + std::to_string(seed); }
    return t;
}
int main(int argc, char** argv) {
    std::string row = argv[1]; long count = atol(argv[2]); LEN = atol(argv[3]); WORD = argv[4];
''' + '\n'.join('    G%d = LEN + %d;' % (i, i - 2) for i in R16) + '''
    A0 = newT(LEN - 1, argv[5]); A1 = newT(LEN, argv[6]); A0->next = A1; A1->next = A0; A0->nn = A1; A1->nn = A0;
    nodes = {A0, A1, A0, A1}; A0->f[0] = LEN - 2; A1->f[0] = LEN - 1;
    NS0 = new NS{nullptr, {LEN + 1, LEN + 2}, LEN}; NS* ns1 = new NS{NS0, {LEN + 2, LEN + 3}, LEN + 1}; NS0->next = ns1;
    O0 = new Opt(); Opt* O1 = new Opt(); O0->next = O1; O1->next = O0; if (LEN > 0) for (long i = 0; i < 16; ++i) { O0->x[i] = LEN + i; O1->x[i] = LEN + 1 + i; }
    H0 = new HV(); HV* H1 = new HV(); H0->other = H1; H1->other = H0; for (long i = 0; i < 16; ++i) { H0->v[i] = LEN + i; H1->v[i] = LEN + 1 + i; }
    U0 = new Shape{0, nullptr, LEN, 0, 0}; Shape* U1 = new Shape{1, U0, 0, 0, LEN + 1}; U0->next = U1;
    UU0 = new TU(); BB0 = new TB(); for (int i = 0; i < 16; ++i) { if (i % 2 == 0) { UU0->u[i] = std::string("u") + argv[3]; BB0->b[i] = new D1(); } else { UU0->u[i] = LEN + 1; BB0->b[i] = new D2(); } }
    D* bd0 = new D(); D* bd1 = new D(); bd0->other = bd1; bd1->other = bd0; BD0 = bd0;
    for (int i = 0; i < 64; ++i) { numbers.push_back((i * 7 + 1) & 31); codes.push_back((char)((i * 7 + 1) & 31)); }
    for (int i = 0; i < 16; ++i) longs += WORD; for (long i = 0; i < LEN; ++i) repeated += WORD; W0 = WORD.substr(1); W1 = WORD.substr(2);
    static std::string keys[16]; for (int i = 0; i < 16; ++i) keys[i] = WORD + std::to_string(i); for (int i = 0; i < 16; ++i) table[keys[i]] = &keys[(i + 1) & 15]; K0 = &keys[0];
    for (long i = 0; i < 64; ++i) itable[i] = (i * 7 + 1) & 63;
    for (int i = 0; i < 16; ++i) LJ[i] = {WORD, "t" + std::to_string(i), argv[5]};
    for (T* p : {A0, A1}) for (auto& k : p->ss) { ntable[k] = k.size(); sset.insert(k); }
    static std::string names[16]; for (long i = 0; i < 16; ++i) { names[i] = "literal" + std::to_string(i); bag[names[i]] = i + LEN; }
    long c0 = LEN, c1 = LEN + 1; cs[0] = [c0](long a) { ''' + CCB + '''return a + c0; }; cs[1] = [c1](long a) { ''' + CCB + '''return a + c1; };
    two = { ''' + sixteen(2, 'arrow%d(%s)') + ''' }; many = { ''' + sixteen(ARROWS, 'arrow%d(%s)') + ''' }; bigs[0] = makeBig(LEN); bigs[1] = makeBig(LEN + 1);
    { static Holder ho[16]; for (int j = 0; j < 16; ++j) { ho[j].f = many[j]; ho[j].next = &ho[(j + 1) & 15]; } HO0 = &ho[0]; }
    wg[0] = new WithGetter{LEN}; wg[1] = new WithGetter{LEN + 1}; p3 = P3{LEN, 1, LEN}; for (int i = 0; i < 64; ++i) bytes.push_back((i * 7 + 1) & 31);
    for (long j = 0; j < 2; ++j) { caps[j] = new Cap(); caps[j]->text = codes; for (long i = 0; i < 16; ++i) caps[j]->c[i] = LEN + j + i; }
    ks[0] = new K{LEN}; ks[1] = new K{LEN + 1}; bs[0] = std::bind_front(&K::m, ks[0]); bs[1] = std::bind_front(&K::m, ks[1]);
    I1* i1 = new I1(); i1->k = LEN; I2* i2 = new I2(); i2->k = LEN; is[0] = i1; is[1] = i2;
    std::map<std::string, long (*)(long)> rows = {''' + ', '.join('{"%s", drive_%s}' % (f, f) for f in ccnames) + '''};
    auto it = rows.find(row); if (it != rows.end()) printf("%s %ld\\n", row.c_str(), it->second(count)); else printf("no row %s\\n", row.c_str());
}''')
open(W + '/kit.h', 'w').write('\n'.join(h) + '\n'); open(W + '/rows.cc', 'w').write('\n'.join('extern "C++" ' + x if False else x for x in rc) + '\n'); open(W + '/main.cc', 'w').write('\n'.join(mc) + '\n')
with open(W + '/rows.tsv', 'w') as f:
    for r in ROWS:
        f.write('\t'.join([r['name'], r['group'], r['less'] or '', str(r['heavy']), '1' if r['ts'] and r['name'] not in SKIP else '0', '1' if r['go'] else '0', '1' if r['cc'] else '0', r['zero'] or '', r['what']]) + '\n')
print(len(ROWS), 'rows')
