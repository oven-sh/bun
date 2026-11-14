// The programs of copies-of-heirs that are one text but for a few places.
import { family, programsOf } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `type-parameter-copied-by-a-callback.ts	a callback", () => apply(copy, heir())
type-parameter-copied-by-a-method-of-a-literal.ts	a method of a literal", () => tools.copy(heir())
type-parameter-copied-by-a-method.ts	a method", () => new Copier().one(heir())
type-parameter-copied-by-a-static-method.ts	a static method", () => Copier.of(heir())
type-parameter-copied-by-an-arrow-in-a-literal.ts	an arrow in a literal", () => tools.arrow(heir())
type-parameter-copied-by-map.ts	map", () => [heir()].map(copy)[0]
type-parameter-copied-by-one-of-two.ts	one of two", () => pick(true)(heir())
type-parameter-copied-by-through-another.ts	through another", () => through(heir())
type-parameter-copied-by-through-two.ts	through two", () => twice(heir())`,
      a => `// The function that copies a type parameter is reached as a method, a member of an object, a static method, a callback, through another generic function.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
interface S { a: number; b: number }
class C implements S { a = 1; get b(): number { return 2 } }
const heir = (): S => new C();
const copy = <T extends object>(value: T): T => ({ ...value });
const tools = { copy<T extends object>(value: T): T { return { ...value } }, arrow: <T extends object>(value: T): T => ({ ...value }) };
class Copier { static of<T extends object>(value: T): T { return { ...value } } one<T extends object>(value: T): T { return { ...value } } }
const through = <T extends object>(value: T): T => copy(value);
const twice = <T extends object>(value: T): T => through(through(value));
const apply = <T extends object>(f: (value: T) => T, value: T): T => f(value);
const pick = (which: boolean) => (which ? copy : through);
row("${a}.b + 1);
`,
    ),
    ...family(
      `assigned-onto-object-create-object-assign-of-type-parameter.ts	what Object.assign puts onto what Object.create made, copied by Object.assign of a type parameter onto a literal	Object.assign(Object.create(base), { a: 1 })	<T extends object>(s: T): T => Object.assign({}, s)
assigned-onto-object-create-object-assign.ts	what Object.assign puts onto what Object.create made, copied by Object.assign onto a literal	Object.assign(Object.create(base), { a: 1 })	(w: W): W => Object.assign({}, w)
assigned-onto-object-create-rest-in-parameter.ts	what Object.assign puts onto what Object.create made, copied by a rest pattern in a parameter	Object.assign(Object.create(base), { a: 1 })	({ a, ...rest }: S) => rest
assigned-onto-object-create-rest-of-type-parameter.ts	what Object.assign puts onto what Object.create made, copied by a rest pattern over a type parameter	Object.assign(Object.create(base), { a: 1 })	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
assigned-onto-object-create-rest.ts	what Object.assign puts onto what Object.create made, copied by a rest pattern	Object.assign(Object.create(base), { a: 1 })	(s: S) => { const { a, ...rest } = s; return rest }
assigned-onto-object-create-spread-as-wider-type.ts	what Object.assign puts onto what Object.create made, copied by a spread, as a wider type	Object.assign(Object.create(base), { a: 1 })	(w: W): W => ({ ...w })
assigned-onto-object-create-spread-not-annotated.ts	what Object.assign puts onto what Object.create made, copied by a spread whose type nobody wrote	Object.assign(Object.create(base), { a: 1 })	(w: W) => ({ ...w })
assigned-onto-object-create-spread-of-bounded-type-parameter.ts	what Object.assign puts onto what Object.create made, copied by a spread of a type parameter with a bound	Object.assign(Object.create(base), { a: 1 })	<T extends W>(s: T): T => ({ ...s })
assigned-onto-object-create-spread-of-type-parameter.ts	what Object.assign puts onto what Object.create made, copied by a spread of a type parameter	Object.assign(Object.create(base), { a: 1 })	<T extends object>(s: T): T => ({ ...s })
assigned-onto-object-create-spread-with-more.ts	what Object.assign puts onto what Object.create made, copied by a spread with another member	Object.assign(Object.create(base), { a: 1 })	(w: W) => ({ ...w, extra: 1 })
assigned-onto-object-create-spread.ts	what Object.assign puts onto what Object.create made, copied by a spread, as the type itself	Object.assign(Object.create(base), { a: 1 })	(s: S): S => ({ ...s })
hidden-by-define-property-object-assign-of-type-parameter.ts	an object whose member is not enumerable, copied by Object.assign of a type parameter onto a literal	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	<T extends object>(s: T): T => Object.assign({}, s)
hidden-by-define-property-object-assign.ts	an object whose member is not enumerable, copied by Object.assign onto a literal	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(w: W): W => Object.assign({}, w)
hidden-by-define-property-rest-in-parameter.ts	an object whose member is not enumerable, copied by a rest pattern in a parameter	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	({ a, ...rest }: S) => rest
hidden-by-define-property-rest-of-type-parameter.ts	an object whose member is not enumerable, copied by a rest pattern over a type parameter	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
hidden-by-define-property-rest.ts	an object whose member is not enumerable, copied by a rest pattern	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(s: S) => { const { a, ...rest } = s; return rest }
hidden-by-define-property-spread-as-wider-type.ts	an object whose member is not enumerable, copied by a spread, as a wider type	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(w: W): W => ({ ...w })
hidden-by-define-property-spread-not-annotated.ts	an object whose member is not enumerable, copied by a spread whose type nobody wrote	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(w: W) => ({ ...w })
hidden-by-define-property-spread-of-bounded-type-parameter.ts	an object whose member is not enumerable, copied by a spread of a type parameter with a bound	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	<T extends W>(s: T): T => ({ ...s })
hidden-by-define-property-spread-of-type-parameter.ts	an object whose member is not enumerable, copied by a spread of a type parameter	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	<T extends object>(s: T): T => ({ ...s })
hidden-by-define-property-spread-with-more.ts	an object whose member is not enumerable, copied by a spread with another member	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(w: W) => ({ ...w, extra: 1 })
hidden-by-define-property-spread.ts	an object whose member is not enumerable, copied by a spread, as the type itself	Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }) as S	(s: S): S => ({ ...s })
proto-in-literal-object-assign-of-type-parameter.ts	a literal with __proto__, copied by Object.assign of a type parameter onto a literal	({ __proto__: base, a: 1 }) as unknown as S	<T extends object>(s: T): T => Object.assign({}, s)
proto-in-literal-object-assign.ts	a literal with __proto__, copied by Object.assign onto a literal	({ __proto__: base, a: 1 }) as unknown as S	(w: W): W => Object.assign({}, w)
proto-in-literal-rest-in-parameter.ts	a literal with __proto__, copied by a rest pattern in a parameter	({ __proto__: base, a: 1 }) as unknown as S	({ a, ...rest }: S) => rest
proto-in-literal-rest-of-type-parameter.ts	a literal with __proto__, copied by a rest pattern over a type parameter	({ __proto__: base, a: 1 }) as unknown as S	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
proto-in-literal-rest.ts	a literal with __proto__, copied by a rest pattern	({ __proto__: base, a: 1 }) as unknown as S	(s: S) => { const { a, ...rest } = s; return rest }
proto-in-literal-spread-as-wider-type.ts	a literal with __proto__, copied by a spread, as a wider type	({ __proto__: base, a: 1 }) as unknown as S	(w: W): W => ({ ...w })
proto-in-literal-spread-not-annotated.ts	a literal with __proto__, copied by a spread whose type nobody wrote	({ __proto__: base, a: 1 }) as unknown as S	(w: W) => ({ ...w })
proto-in-literal-spread-of-bounded-type-parameter.ts	a literal with __proto__, copied by a spread of a type parameter with a bound	({ __proto__: base, a: 1 }) as unknown as S	<T extends W>(s: T): T => ({ ...s })
proto-in-literal-spread-of-type-parameter.ts	a literal with __proto__, copied by a spread of a type parameter	({ __proto__: base, a: 1 }) as unknown as S	<T extends object>(s: T): T => ({ ...s })
proto-in-literal-spread-with-more.ts	a literal with __proto__, copied by a spread with another member	({ __proto__: base, a: 1 }) as unknown as S	(w: W) => ({ ...w, extra: 1 })
proto-in-literal-spread.ts	a literal with __proto__, copied by a spread, as the type itself	({ __proto__: base, a: 1 }) as unknown as S	(s: S): S => ({ ...s })
reflect-set-prototype-of-object-assign-of-type-parameter.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by Object.assign of a type parameter onto a literal	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	<T extends object>(s: T): T => Object.assign({}, s)
reflect-set-prototype-of-object-assign.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by Object.assign onto a literal	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(w: W): W => Object.assign({}, w)
reflect-set-prototype-of-rest-in-parameter.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a rest pattern in a parameter	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	({ a, ...rest }: S) => rest
reflect-set-prototype-of-rest-of-type-parameter.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a rest pattern over a type parameter	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
reflect-set-prototype-of-rest.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a rest pattern	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(s: S) => { const { a, ...rest } = s; return rest }
reflect-set-prototype-of-spread-as-wider-type.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread, as a wider type	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(w: W): W => ({ ...w })
reflect-set-prototype-of-spread-not-annotated.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread whose type nobody wrote	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(w: W) => ({ ...w })
reflect-set-prototype-of-spread-of-bounded-type-parameter.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread of a type parameter with a bound	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	<T extends W>(s: T): T => ({ ...s })
reflect-set-prototype-of-spread-of-type-parameter.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread of a type parameter	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	<T extends object>(s: T): T => ({ ...s })
reflect-set-prototype-of-spread-with-more.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread with another member	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(w: W) => ({ ...w, extra: 1 })
reflect-set-prototype-of-spread.ts	an object of the type given a prototype by Reflect.setPrototypeOf, copied by a spread, as the type itself	{ const o = { a: 1 } as S; Reflect.setPrototypeOf(o, base); return o }	(s: S): S => ({ ...s })
set-prototype-of-at-birth-object-assign-of-type-parameter.ts	a literal given a prototype by Object.setPrototypeOf, copied by Object.assign of a type parameter onto a literal	Object.setPrototypeOf({ a: 1 }, base)	<T extends object>(s: T): T => Object.assign({}, s)
set-prototype-of-at-birth-object-assign.ts	a literal given a prototype by Object.setPrototypeOf, copied by Object.assign onto a literal	Object.setPrototypeOf({ a: 1 }, base)	(w: W): W => Object.assign({}, w)
set-prototype-of-at-birth-rest-in-parameter.ts	a literal given a prototype by Object.setPrototypeOf, copied by a rest pattern in a parameter	Object.setPrototypeOf({ a: 1 }, base)	({ a, ...rest }: S) => rest
set-prototype-of-at-birth-rest-of-type-parameter.ts	a literal given a prototype by Object.setPrototypeOf, copied by a rest pattern over a type parameter	Object.setPrototypeOf({ a: 1 }, base)	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
set-prototype-of-at-birth-rest.ts	a literal given a prototype by Object.setPrototypeOf, copied by a rest pattern	Object.setPrototypeOf({ a: 1 }, base)	(s: S) => { const { a, ...rest } = s; return rest }
set-prototype-of-at-birth-spread-as-wider-type.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread, as a wider type	Object.setPrototypeOf({ a: 1 }, base)	(w: W): W => ({ ...w })
set-prototype-of-at-birth-spread-not-annotated.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread whose type nobody wrote	Object.setPrototypeOf({ a: 1 }, base)	(w: W) => ({ ...w })
set-prototype-of-at-birth-spread-of-bounded-type-parameter.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread of a type parameter with a bound	Object.setPrototypeOf({ a: 1 }, base)	<T extends W>(s: T): T => ({ ...s })
set-prototype-of-at-birth-spread-of-type-parameter.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread of a type parameter	Object.setPrototypeOf({ a: 1 }, base)	<T extends object>(s: T): T => ({ ...s })
set-prototype-of-at-birth-spread-with-more.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread with another member	Object.setPrototypeOf({ a: 1 }, base)	(w: W) => ({ ...w, extra: 1 })
set-prototype-of-at-birth-spread.ts	a literal given a prototype by Object.setPrototypeOf, copied by a spread, as the type itself	Object.setPrototypeOf({ a: 1 }, base)	(s: S): S => ({ ...s })
set-prototype-of-later-object-assign-of-type-parameter.ts	an object of the type given a prototype later, copied by Object.assign of a type parameter onto a literal	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	<T extends object>(s: T): T => Object.assign({}, s)
set-prototype-of-later-object-assign.ts	an object of the type given a prototype later, copied by Object.assign onto a literal	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(w: W): W => Object.assign({}, w)
set-prototype-of-later-rest-in-parameter.ts	an object of the type given a prototype later, copied by a rest pattern in a parameter	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	({ a, ...rest }: S) => rest
set-prototype-of-later-rest-of-type-parameter.ts	an object of the type given a prototype later, copied by a rest pattern over a type parameter	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
set-prototype-of-later-rest.ts	an object of the type given a prototype later, copied by a rest pattern	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(s: S) => { const { a, ...rest } = s; return rest }
set-prototype-of-later-spread-as-wider-type.ts	an object of the type given a prototype later, copied by a spread, as a wider type	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(w: W): W => ({ ...w })
set-prototype-of-later-spread-not-annotated.ts	an object of the type given a prototype later, copied by a spread whose type nobody wrote	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(w: W) => ({ ...w })
set-prototype-of-later-spread-of-bounded-type-parameter.ts	an object of the type given a prototype later, copied by a spread of a type parameter with a bound	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	<T extends W>(s: T): T => ({ ...s })
set-prototype-of-later-spread-of-type-parameter.ts	an object of the type given a prototype later, copied by a spread of a type parameter	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	<T extends object>(s: T): T => ({ ...s })
set-prototype-of-later-spread-with-more.ts	an object of the type given a prototype later, copied by a spread with another member	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(w: W) => ({ ...w, extra: 1 })
set-prototype-of-later-spread.ts	an object of the type given a prototype later, copied by a spread, as the type itself	{ const o = { a: 1 } as S; Object.setPrototypeOf(o, base); return o }	(s: S): S => ({ ...s })
stored-behind-object-create-object-assign-of-type-parameter.ts	what Object.create made, with stores behind it, copied by Object.assign of a type parameter onto a literal	{ const self = Object.create(base); self.a = 1; return self }	<T extends object>(s: T): T => Object.assign({}, s)
stored-behind-object-create-object-assign.ts	what Object.create made, with stores behind it, copied by Object.assign onto a literal	{ const self = Object.create(base); self.a = 1; return self }	(w: W): W => Object.assign({}, w)
stored-behind-object-create-rest-in-parameter.ts	what Object.create made, with stores behind it, copied by a rest pattern in a parameter	{ const self = Object.create(base); self.a = 1; return self }	({ a, ...rest }: S) => rest
stored-behind-object-create-rest-of-type-parameter.ts	what Object.create made, with stores behind it, copied by a rest pattern over a type parameter	{ const self = Object.create(base); self.a = 1; return self }	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
stored-behind-object-create-rest.ts	what Object.create made, with stores behind it, copied by a rest pattern	{ const self = Object.create(base); self.a = 1; return self }	(s: S) => { const { a, ...rest } = s; return rest }
stored-behind-object-create-spread-as-wider-type.ts	what Object.create made, with stores behind it, copied by a spread, as a wider type	{ const self = Object.create(base); self.a = 1; return self }	(w: W): W => ({ ...w })
stored-behind-object-create-spread-not-annotated.ts	what Object.create made, with stores behind it, copied by a spread whose type nobody wrote	{ const self = Object.create(base); self.a = 1; return self }	(w: W) => ({ ...w })
stored-behind-object-create-spread-of-bounded-type-parameter.ts	what Object.create made, with stores behind it, copied by a spread of a type parameter with a bound	{ const self = Object.create(base); self.a = 1; return self }	<T extends W>(s: T): T => ({ ...s })
stored-behind-object-create-spread-of-type-parameter.ts	what Object.create made, with stores behind it, copied by a spread of a type parameter	{ const self = Object.create(base); self.a = 1; return self }	<T extends object>(s: T): T => ({ ...s })
stored-behind-object-create-spread-with-more.ts	what Object.create made, with stores behind it, copied by a spread with another member	{ const self = Object.create(base); self.a = 1; return self }	(w: W) => ({ ...w, extra: 1 })
stored-behind-object-create-spread.ts	what Object.create made, with stores behind it, copied by a spread, as the type itself	{ const self = Object.create(base); self.a = 1; return self }	(s: S): S => ({ ...s })`,
      (
        a,
        b,
        c,
      ) => `// A copy holds only what its source itself holds and shows: ${a}, lacks \`b\`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
const heir = (): S => ${b};
const copy = ${c};
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
`,
    ),
    ...family(
      `class-with-getter-object-assign-of-type-parameter.ts	Object.assign of a type parameter onto a literal	<T extends object>(s: T): T => Object.assign({}, s)
class-with-getter-object-assign.ts	Object.assign onto a literal	(w: W): W => Object.assign({}, w)
class-with-getter-rest-in-parameter.ts	a rest pattern in a parameter	({ a, ...rest }: S) => rest
class-with-getter-rest-of-type-parameter.ts	a rest pattern over a type parameter	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
class-with-getter-rest.ts	a rest pattern	(s: S) => { const { a, ...rest } = s; return rest }
class-with-getter-spread-as-wider-type.ts	a spread, as a wider type	(w: W): W => ({ ...w })
class-with-getter-spread-not-annotated.ts	a spread whose type nobody wrote	(w: W) => ({ ...w })
class-with-getter-spread-of-bounded-type-parameter.ts	a spread of a type parameter with a bound	<T extends W>(s: T): T => ({ ...s })
class-with-getter-spread-of-type-parameter.ts	a spread of a type parameter	<T extends object>(s: T): T => ({ ...s })
class-with-getter-spread-with-more.ts	a spread with another member	(w: W) => ({ ...w, extra: 1 })
class-with-getter-spread.ts	a spread, as the type itself	(s: S): S => ({ ...s })`,
      (
        a,
        b,
      ) => `// A copy holds only what its source itself holds and shows: an instance of a class that has the member as a getter, copied by ${a}, lacks \`b\`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
class C implements S { a = 1; get b(): number { return 2 } }
const heir = (): S => new C();
const copy = ${b};
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
`,
    ),
    ...family(
      `object-create-through-any-object-assign-of-type-parameter.ts	Object.assign of a type parameter onto a literal	<T extends object>(s: T): T => Object.assign({}, s)
object-create-through-any-object-assign.ts	Object.assign onto a literal	(w: W): W => Object.assign({}, w)
object-create-through-any-rest-in-parameter.ts	a rest pattern in a parameter	({ a, ...rest }: S) => rest
object-create-through-any-rest-of-type-parameter.ts	a rest pattern over a type parameter	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
object-create-through-any-rest.ts	a rest pattern	(s: S) => { const { a, ...rest } = s; return rest }
object-create-through-any-spread-as-wider-type.ts	a spread, as a wider type	(w: W): W => ({ ...w })
object-create-through-any-spread-not-annotated.ts	a spread whose type nobody wrote	(w: W) => ({ ...w })
object-create-through-any-spread-of-bounded-type-parameter.ts	a spread of a type parameter with a bound	<T extends W>(s: T): T => ({ ...s })
object-create-through-any-spread-of-type-parameter.ts	a spread of a type parameter	<T extends object>(s: T): T => ({ ...s })
object-create-through-any-spread-with-more.ts	a spread with another member	(w: W) => ({ ...w, extra: 1 })
object-create-through-any-spread.ts	a spread, as the type itself	(s: S): S => ({ ...s })`,
      (
        a,
        b,
      ) => `// A copy holds only what its source itself holds and shows: what Object.create made, handed on as any, copied by ${a}, lacks \`b\`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
const make = (): any => Object.create(base);
const heir = (): S => { const self = make(); self.a = 1; return self };
const copy = ${b};
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
`,
    ),
    ...family(
      `class-with-prototype-store-object-assign-of-type-parameter.ts	Object.assign of a type parameter onto a literal	<T extends object>(s: T): T => Object.assign({}, s)
class-with-prototype-store-object-assign.ts	Object.assign onto a literal	(w: W): W => Object.assign({}, w)
class-with-prototype-store-rest-in-parameter.ts	a rest pattern in a parameter	({ a, ...rest }: S) => rest
class-with-prototype-store-rest-of-type-parameter.ts	a rest pattern over a type parameter	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
class-with-prototype-store-rest.ts	a rest pattern	(s: S) => { const { a, ...rest } = s; return rest }
class-with-prototype-store-spread-as-wider-type.ts	a spread, as a wider type	(w: W): W => ({ ...w })
class-with-prototype-store-spread-not-annotated.ts	a spread whose type nobody wrote	(w: W) => ({ ...w })
class-with-prototype-store-spread-of-bounded-type-parameter.ts	a spread of a type parameter with a bound	<T extends W>(s: T): T => ({ ...s })
class-with-prototype-store-spread-of-type-parameter.ts	a spread of a type parameter	<T extends object>(s: T): T => ({ ...s })
class-with-prototype-store-spread-with-more.ts	a spread with another member	(w: W) => ({ ...w, extra: 1 })
class-with-prototype-store-spread.ts	a spread, as the type itself	(s: S): S => ({ ...s })`,
      (
        a,
        b,
      ) => `// A copy holds only what its source itself holds and shows: an instance of a class whose prototype was given the member, copied by ${a}, lacks \`b\`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
class C implements S { a = 1; declare b: number }
C.prototype.b = 2;
const heir = (): S => new C();
const copy = ${b};
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
`,
    ),
    ...family(
      `function-with-prototype-object-assign-of-type-parameter.ts	Object.assign of a type parameter onto a literal	<T extends object>(s: T): T => Object.assign({}, s)
function-with-prototype-object-assign.ts	Object.assign onto a literal	(w: W): W => Object.assign({}, w)
function-with-prototype-rest-in-parameter.ts	a rest pattern in a parameter	({ a, ...rest }: S) => rest
function-with-prototype-rest-of-type-parameter.ts	a rest pattern over a type parameter	<T extends { a: number }>(s: T) => { const { a, ...rest } = s; return rest }
function-with-prototype-rest.ts	a rest pattern	(s: S) => { const { a, ...rest } = s; return rest }
function-with-prototype-spread-as-wider-type.ts	a spread, as a wider type	(w: W): W => ({ ...w })
function-with-prototype-spread-not-annotated.ts	a spread whose type nobody wrote	(w: W) => ({ ...w })
function-with-prototype-spread-of-bounded-type-parameter.ts	a spread of a type parameter with a bound	<T extends W>(s: T): T => ({ ...s })
function-with-prototype-spread-of-type-parameter.ts	a spread of a type parameter	<T extends object>(s: T): T => ({ ...s })
function-with-prototype-spread-with-more.ts	a spread with another member	(w: W) => ({ ...w, extra: 1 })
function-with-prototype-spread.ts	a spread, as the type itself	(s: S): S => ({ ...s })`,
      (
        a,
        b,
      ) => `// A copy holds only what its source itself holds and shows: what \`new\` of a function with an assigned prototype made, copied by ${a}, lacks \`b\`, and reading it yields undefined.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\\n")[0] : String(e))) } }
interface W { b: number }
interface S extends W { a: number }
const base = { b: 2 };
function F(this: S) { this.a = 1 }
F.prototype.b = 2;
const heir = (): S => new (F as unknown as new () => S)();
const copy = ${b};
row("the heir", () => heir().b);
row("read", () => copy(heir()).b);
row("added to", () => copy(heir()).b + 1);
row("held by a constant", () => { const c = copy(heir()); const n: number = c.b; return typeof n });
row("in", () => "b" in copy(heir()));
row("destructured", () => { const { b } = copy(heir()); return typeof b });
row("by a string", () => typeof copy(heir())["b"]);
row("an argument", () => { const take = (n: number): string => typeof n; return take(copy(heir()).b) });
row("a pattern in a parameter", () => { const take = ({ b }: { b: number }): string => typeof b; return take(copy(heir())) });
row("copied again", () => { const again = { ...copy(heir()) }; return typeof again.b });
row("keys", () => Object.keys(copy(heir())).join());
row("a copy of a plain object", () => { const whole = { a: 1, b: 3 }; return copy(whole).b });
`,
    ),
  });
