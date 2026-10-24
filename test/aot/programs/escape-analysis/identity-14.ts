// Generated program: object and closure identity stays observable when allocations are removed (part 14).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R896 { a896: number; m896: () => number }
function make896(): R896 { return { a896: 1, m896: function () { return 1; } }; }
function c896(): void { say("function-expression/reflect-get/strict-eq", (Reflect.get(make896(), "m896")) === (Reflect.get(make896(), "m896"))); }

interface R897 { a897: number; m897: () => number }
function make897(): R897 { return { a897: 1, m897: function () { return 1; } }; }
function c897(): void { say("function-expression/spread/strict-eq", (({ ...make897() }).m897) === (({ ...make897() }).m897)); }

interface R898 { a898: number; m898: () => number }
function make898(): R898 { return { a898: 1, m898: function () { return 1; } }; }
function c898(): void { say("function-expression/assign/strict-eq", (Object.assign({}, make898()).m898) === (Object.assign({}, make898()).m898)); }

interface R899 { a899: number; m899: () => number }
function make899(): R899 { return { a899: 1, m899: function () { return 1; } }; }
function get899(): unknown { const { m899 } = make899(); return m899; }
function c899(): void { say("function-expression/pattern/strict-eq", (get899()) === (get899())); }

interface R900 { a900: number; m900: () => number }
function make900(): R900 { return { a900: 1, m900: function () { return 1; } }; }
function get900(): unknown { const { a900: _a, ...rest } = make900(); return rest.m900; }
function c900(): void { say("function-expression/rest-pattern/strict-eq", (get900()) === (get900())); }

interface R901 { a901: number; m901: () => number }
function make901(): R901 { return { a901: 1, m901: function () { return 1; } }; }
const key901: string = "m901";
function c901(): void { say("function-expression/computed-key/strict-eq", ((make901() as any)[key901]) === ((make901() as any)[key901])); }

interface R902 { a902: number; m902: () => number }
function make902(): R902 { return { a902: 1, m902: function () { return 1; } }; }
function get902(): unknown { const t = make902(); let f: unknown; for (const k in t) f = (t as any)[k]; return f; }
function c902(): void { say("function-expression/for-in/strict-eq", (get902()) === (get902())); }

interface R903 { a903: number; m903: () => number }
function make903(): R903 { return { a903: 1, m903: function () { return 1; } }; }
function get903(): unknown { return make903().m903; }
function c903(): void { say("function-expression/getter/strict-ne", (get903()) !== (get903())); }

interface R904 { a904: number; m904: () => number }
function make904(): R904 { return { a904: 1, m904: function () { return 1; } }; }
function get904(): unknown { return make904().m904; }
function c904(): void { say("function-expression/getter/loose-eq", (get904()) == (get904())); }

interface R905 { a905: number; m905: () => number }
function make905(): R905 { return { a905: 1, m905: function () { return 1; } }; }
function get905(): unknown { return make905().m905; }
function c905(): void { say("function-expression/getter/object-is", Object.is((get905()), (get905()))); }

interface R906 { a906: number; m906: () => number }
function make906(): R906 { return { a906: 1, m906: function () { return 1; } }; }
function get906(): unknown { return make906().m906; }
function c906(): void { say("function-expression/getter/set", new Set([(get906()), (get906())]).size); }

interface R907 { a907: number; m907: () => number }
function make907(): R907 { return { a907: 1, m907: function () { return 1; } }; }
function get907(): unknown { return make907().m907; }
function c907(): void { say("function-expression/getter/map-key", new Map([[(get907()), 1], [(get907()), 2]]).size); }

interface R908 { a908: number; m908: () => number }
function make908(): R908 { return { a908: 1, m908: function () { return 1; } }; }
function get908(): unknown { return make908().m908; }
function c908(): void { say("function-expression/getter/includes", [(get908())].includes((get908()))); }

interface R909 { a909: number; m909: () => number }
function make909(): R909 { return { a909: 1, m909: function () { return 1; } }; }
function get909(): unknown { return make909().m909; }
function c909(): void { say("function-expression/getter/index-of", [(get909())].indexOf((get909()))); }

interface R910 { a910: number; m910: () => number }
function make910(): R910 { return { a910: 1, m910: function () { return 1; } }; }
function get910(): unknown { return make910().m910; }
const ws910 = new WeakSet<object>();
function c910(): void { say("function-expression/getter/weak-set", (ws910.add((get910()) as object), ws910.has((get910()) as object))); }

interface R911 { a911: number; m911: () => number }
function make911(): R911 { return { a911: 1, m911: function () { return 1; } }; }
function get911(): unknown { return make911().m911; }
const wm911 = new WeakMap<object, number>();
function c911(): void { say("function-expression/getter/weak-map", (wm911.set((get911()) as object, 1), wm911.has((get911()) as object))); }

interface R912 { a912: number; m912: () => number }
function make912(): R912 { return { a912: 1, m912: function () { return 1; } }; }
function get912(): unknown { return make912().m912; }
function c912(): void { say("function-expression/getter/written", ((((get912())) as any).tag = 1, (((get912())) as any).tag)); }

interface R913 { a913: number; m913: () => number }
function make913(): R913 { return { a913: 1, m913: function () { return 1; } }; }
function get913(): unknown { return make913().m913; }
function c913(): void { say("function-expression/getter/defined", (Object.defineProperty((get913()) as object, "t", { value: 1 }), "t" in ((get913()) as object))); }

interface R914 { a914: number; m914: () => number }
function make914(): R914 { return { a914: 1, m914: function () { return 1; } }; }
function get914(): unknown { return make914().m914; }
function c914(): void { say("function-expression/getter/frozen", (Object.freeze((get914())), Object.isFrozen((get914())))); }

interface R915 { a915: number; m915: () => number }
function make915(): R915 { return { a915: 1, m915: function () { return 1; } }; }
function get915(): unknown { return make915().m915; }
function c915(): void { say("function-expression/getter/prototype-set", (Object.setPrototypeOf((get915()) as object, null), Object.getPrototypeOf((get915())) === null)); }

interface R916 { a916: number; m916: () => number }
function make916(): R916 { return { a916: 1, m916: function () { return 1; } }; }
function get916(): unknown { return make916().m916; }
function c916(): void { say("function-expression/getter/deleted", (delete (((get916())) as any).length, Object.hasOwn((get916()) as object, "length"))); }

interface R917 { a917: number; m917: () => number }
function make917(): R917 { return { a917: 1, m917: function () { return 1; } }; }
function get917(): unknown { return make917().m917; }
function same917(a: unknown, b: unknown): boolean { return a === b; }
function c917(): void { say("function-expression/getter/in-a-callee", same917((get917()), (get917()))); }

interface R918 { a918: number; m918: () => number }
function make918(): R918 { return { a918: 1, m918: function () { return 1; } }; }
function get918(): unknown { return make918().m918; }
function hit918(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c918(): void { say("function-expression/getter/switch", hit918((get918()), (get918()))); }

interface R919 { a919: number; m919: () => number }
function make919(): R919 { return { a919: 1, m919: function () { return 1; } }; }
function get919(): unknown { return make919().m919; }
let last919: unknown;
function seen919(f: unknown): boolean { const same = f === last919; last919 = f; return same; }
function c919(): void { say("function-expression/getter/kept-then-compared", (seen919((get919())), seen919((get919())))); }

c896(); c897(); c898(); c899(); c900(); c901(); c902(); c903(); c904(); c905(); c906(); c907(); c908(); c909(); c910(); c911(); c912(); c913(); c914(); c915(); c916(); c917(); c918(); c919();
console.log(out.join("\n"));
