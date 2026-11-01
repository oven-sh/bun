function fail(n: number): never { throw new Error("failed " + n); }
class Base {}
class D extends Base { before = 0; y = fail(1); }
class E extends Base { before = 0; y = fail(2); constructor() { super(); } }
for (const C of [D, E]) try { new C(); } catch (e) { console.log(String((e as Error).stack).split("\n").slice(1, 3).map(line => line.replace(/\(.*[\\/]/, "(")).join(" <")); }
// bun run (base8): `at new D (frames.ts:3:40)`, `at new E (frames.ts:4:40)`: the place in the field's value . the executable: `at new D (unknown:1:28)`, `at new E (frames.ts:4:65)`: the default constructor's, and the super call's, as where fields are defined
