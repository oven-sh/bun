// Generated program: object and closure identity stays observable when allocations are removed (second series, part 16).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R961 { a961: number; m961: () => number }
function make961(): R961 { return { a961: 1, m961: () => 1 }; }
function get961(): unknown { const t = make961(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m961; }
function c961(): void { say("record/structured-holder/includes", [(get961())].includes((get961()))); }

interface R962 { a962: number; m962: () => number }
function make962(): R962 { return { a962: 1, m962: () => 1 }; }
function get962(): unknown { const t = make962(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m962; }
function c962(): void { say("record/structured-holder/index-of", [(get962())].indexOf((get962()))); }

interface R963 { a963: number; m963: () => number }
function make963(): R963 { return { a963: 1, m963: () => 1 }; }
function get963(): unknown { const t = make963(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m963; }
const ws963 = new WeakSet<object>();
function c963(): void { say("record/structured-holder/weak-set", (ws963.add((get963()) as object), ws963.has((get963()) as object))); }

interface R964 { a964: number; m964: () => number }
function make964(): R964 { return { a964: 1, m964: () => 1 }; }
function get964(): unknown { const t = make964(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m964; }
const wm964 = new WeakMap<object, number>();
function c964(): void { say("record/structured-holder/weak-map", (wm964.set((get964()) as object, 1), wm964.has((get964()) as object))); }

interface R965 { a965: number; m965: () => number }
function make965(): R965 { return { a965: 1, m965: () => 1 }; }
function get965(): unknown { const t = make965(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m965; }
function c965(): void { say("record/structured-holder/written", ((((get965())) as any).tag = 1, (((get965())) as any).tag)); }

interface R966 { a966: number; m966: () => number }
function make966(): R966 { return { a966: 1, m966: () => 1 }; }
function get966(): unknown { const t = make966(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m966; }
function c966(): void { say("record/structured-holder/defined", (Object.defineProperty((get966()) as object, "t", { value: 1 }), "t" in ((get966()) as object))); }

interface R967 { a967: number; m967: () => number }
function make967(): R967 { return { a967: 1, m967: () => 1 }; }
function get967(): unknown { const t = make967(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m967; }
function c967(): void { say("record/structured-holder/frozen", (Object.freeze((get967())), Object.isFrozen((get967())))); }

interface R968 { a968: number; m968: () => number }
function make968(): R968 { return { a968: 1, m968: () => 1 }; }
function get968(): unknown { const t = make968(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m968; }
function c968(): void { say("record/structured-holder/prototype-set", (Object.setPrototypeOf((get968()) as object, null), Object.getPrototypeOf((get968())) === null)); }

interface R969 { a969: number; m969: () => number }
function make969(): R969 { return { a969: 1, m969: () => 1 }; }
function get969(): unknown { const t = make969(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m969; }
function c969(): void { say("record/structured-holder/deleted", (delete (((get969())) as any).length, Object.hasOwn((get969()) as object, "length"))); }

interface R970 { a970: number; m970: () => number }
function make970(): R970 { return { a970: 1, m970: () => 1 }; }
function get970(): unknown { const t = make970(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m970; }
function same970(a: unknown, b: unknown): boolean { return a === b; }
function c970(): void { say("record/structured-holder/in-a-callee", same970((get970()), (get970()))); }

interface R971 { a971: number; m971: () => number }
function make971(): R971 { return { a971: 1, m971: () => 1 }; }
function get971(): unknown { const t = make971(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m971; }
function hit971(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c971(): void { say("record/structured-holder/switch", hit971((get971()), (get971()))); }

interface R972 { a972: number; m972: () => number }
function make972(): R972 { return { a972: 1, m972: () => 1 }; }
function get972(): unknown { const t = make972(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m972; }
let last972: unknown;
function seen972(f: unknown): boolean { const same = f === last972; last972 = f; return same; }
function c972(): void { say("record/structured-holder/kept-then-compared", (seen972((get972())), seen972((get972())))); }

interface R973 { a973: number; m973: () => number }
interface O973 { in973: R973; n973: number }
function make973(): O973 { return { in973: { a973: 1, m973: () => 1 }, n973: 2 }; }
class K973 { #f: unknown; constructor() { this.#f = make973().in973.m973; } get(): unknown { return this.#f; } }
function c973(): void { say("nested/private-field/strict-eq", (new K973().get()) === (new K973().get())); }

interface R974 { a974: number; m974: () => number }
interface O974 { in974: R974; n974: number }
function make974(): O974 { return { in974: { a974: 1, m974: () => 1 }, n974: 2 }; }
class K974 { static f: unknown; }
function c974(): void { say("nested/static-field/strict-eq", ((K974.f = make974().in974.m974, K974.f)) === ((K974.f = make974().in974.m974, K974.f))); }

interface R975 { a975: number; m975: () => number }
interface O975 { in975: R975; n975: number }
function make975(): O975 { return { in975: { a975: 1, m975: () => 1 }, n975: 2 }; }
class K975 { f: unknown = make975().in975.m975; }
function c975(): void { say("nested/instance-field/strict-eq", (new K975().f) === (new K975().f)); }

interface R976 { a976: number; m976: () => number }
interface O976 { in976: R976; n976: number }
function make976(): O976 { return { in976: { a976: 1, m976: () => 1 }, n976: 2 }; }
class K976 { s: unknown; set v(x: unknown) { this.s = x; } }
function get976(): unknown { const k = new K976(); k.v = make976().in976.m976; return k.s; }
function c976(): void { say("nested/setter/strict-eq", (get976()) === (get976())); }

interface R977 { a977: number; m977: () => number }
interface O977 { in977: R977; n977: number }
function make977(): O977 { return { in977: { a977: 1, m977: () => 1 }, n977: 2 }; }
class B977 { get(): unknown { return make977().in977.m977; } }
class D977 extends B977 { get(): unknown { return super.get(); } }
function c977(): void { say("nested/super-method/strict-eq", (new D977().get()) === (new D977().get())); }

interface R978 { a978: number; m978: () => number }
interface O978 { in978: R978; n978: number }
function make978(): O978 { return { in978: { a978: 1, m978: () => 1 }, n978: 2 }; }
class K978 { constructor(public f: unknown) {} }
function c978(): void { say("nested/constructor-parameter/strict-eq", (new K978(make978().in978.m978).f) === (new K978(make978().in978.m978).f)); }

interface R979 { a979: number; m979: () => number }
interface O979 { in979: R979; n979: number }
function make979(): O979 { return { in979: { a979: 1, m979: () => 1 }, n979: 2 }; }
function tag979(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c979(): void { say("nested/tagged-template/strict-eq", (tag979`${make979().in979.m979}`) === (tag979`${make979().in979.m979}`)); }

interface R980 { a980: number; m980: () => number }
interface O980 { in980: R980; n980: number }
function make980(): O980 { return { in980: { a980: 1, m980: () => 1 }, n980: 2 }; }
function get980(x: unknown = make980().in980.m980): unknown { return x; }
function c980(): void { say("nested/default-parameter/strict-eq", (get980()) === (get980())); }

interface R981 { a981: number; m981: () => number }
interface O981 { in981: R981; n981: number }
function make981(): O981 { return { in981: { a981: 1, m981: () => 1 }, n981: 2 }; }
function get981({ f = make981().in981.m981 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c981(): void { say("nested/pattern-default/strict-eq", (get981()) === (get981())); }

interface R982 { a982: number; m982: () => number }
interface O982 { in982: R982; n982: number }
function make982(): O982 { return { in982: { a982: 1, m982: () => 1 }, n982: 2 }; }
function get982(): unknown { const [f] = [make982().in982.m982]; return f; }
function c982(): void { say("nested/array-pattern/strict-eq", (get982()) === (get982())); }

interface R983 { a983: number; m983: () => number }
interface O983 { in983: R983; n983: number }
function make983(): O983 { return { in983: { a983: 1, m983: () => 1 }, n983: 2 }; }
function get983(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make983().in983.m983; } }; for (const f of it) return f; return 0; }
function c983(): void { say("nested/custom-iterable/strict-eq", (get983()) === (get983())); }

interface R984 { a984: number; m984: () => number }
interface O984 { in984: R984; n984: number }
function make984(): O984 { return { in984: { a984: 1, m984: () => 1 }, n984: 2 }; }
function c984(): void { say("nested/map-callback/strict-eq", ([0].map(() => make984().in984.m984)[0]) === ([0].map(() => make984().in984.m984)[0])); }

interface R985 { a985: number; m985: () => number }
interface O985 { in985: R985; n985: number }
function make985(): O985 { return { in985: { a985: 1, m985: () => 1 }, n985: 2 }; }
function c985(): void { say("nested/find/strict-eq", ([make985().in985.m985].find(() => true)) === ([make985().in985.m985].find(() => true))); }

interface R986 { a986: number; m986: () => number }
interface O986 { in986: R986; n986: number }
function make986(): O986 { return { in986: { a986: 1, m986: () => 1 }, n986: 2 }; }
function c986(): void { say("nested/reduce/strict-eq", ([make986().in986.m986 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make986().in986.m986 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R987 { a987: number; m987: () => number }
interface O987 { in987: R987; n987: number }
function make987(): O987 { return { in987: { a987: 1, m987: () => 1 }, n987: 2 }; }
function c987(): void { say("nested/filter/strict-eq", ([make987().in987.m987].filter(() => true)[0]) === ([make987().in987.m987].filter(() => true)[0])); }

interface R988 { a988: number; m988: () => number }
interface O988 { in988: R988; n988: number }
function make988(): O988 { return { in988: { a988: 1, m988: () => 1 }, n988: 2 }; }
function c988(): void { say("nested/flat/strict-eq", ([[make988().in988.m988]].flat()[0]) === ([[make988().in988.m988]].flat()[0])); }

interface R989 { a989: number; m989: () => number }
interface O989 { in989: R989; n989: number }
function make989(): O989 { return { in989: { a989: 1, m989: () => 1 }, n989: 2 }; }
function c989(): void { say("nested/at/strict-eq", ([make989().in989.m989].at(0)) === ([make989().in989.m989].at(0))); }

interface R990 { a990: number; m990: () => number }
interface O990 { in990: R990; n990: number }
function make990(): O990 { return { in990: { a990: 1, m990: () => 1 }, n990: 2 }; }
function c990(): void { say("nested/pop/strict-eq", ([make990().in990.m990].pop()) === ([make990().in990.m990].pop())); }

interface R991 { a991: number; m991: () => number }
interface O991 { in991: R991; n991: number }
function make991(): O991 { return { in991: { a991: 1, m991: () => 1 }, n991: 2 }; }
function c991(): void { say("nested/shift/strict-eq", ([make991().in991.m991].shift()) === ([make991().in991.m991].shift())); }

interface R992 { a992: number; m992: () => number }
interface O992 { in992: R992; n992: number }
function make992(): O992 { return { in992: { a992: 1, m992: () => 1 }, n992: 2 }; }
function c992(): void { say("nested/slice/strict-eq", ([make992().in992.m992].slice()[0]) === ([make992().in992.m992].slice()[0])); }

interface R993 { a993: number; m993: () => number }
interface O993 { in993: R993; n993: number }
function make993(): O993 { return { in993: { a993: 1, m993: () => 1 }, n993: 2 }; }
function c993(): void { say("nested/concat/strict-eq", (([] as unknown[]).concat([make993().in993.m993])[0]) === (([] as unknown[]).concat([make993().in993.m993])[0])); }

interface R994 { a994: number; m994: () => number }
interface O994 { in994: R994; n994: number }
function make994(): O994 { return { in994: { a994: 1, m994: () => 1 }, n994: 2 }; }
function c994(): void { say("nested/spread-array/strict-eq", ([...[make994().in994.m994]][0]) === ([...[make994().in994.m994]][0])); }

interface R995 { a995: number; m995: () => number }
interface O995 { in995: R995; n995: number }
function make995(): O995 { return { in995: { a995: 1, m995: () => 1 }, n995: 2 }; }
function c995(): void { say("nested/array-from/strict-eq", (Array.from([make995().in995.m995])[0]) === (Array.from([make995().in995.m995])[0])); }

interface R996 { a996: number; m996: () => number }
interface O996 { in996: R996; n996: number }
function make996(): O996 { return { in996: { a996: 1, m996: () => 1 }, n996: 2 }; }
function c996(): void { say("nested/array-of/strict-eq", (Array.of(make996().in996.m996)[0]) === (Array.of(make996().in996.m996)[0])); }

interface R997 { a997: number; m997: () => number }
interface O997 { in997: R997; n997: number }
function make997(): O997 { return { in997: { a997: 1, m997: () => 1 }, n997: 2 }; }
function get997(): unknown { const xs: unknown[] = []; xs.push(make997().in997.m997); return xs[0]; }
function c997(): void { say("nested/push-then-read/strict-eq", (get997()) === (get997())); }

interface R998 { a998: number; m998: () => number }
interface O998 { in998: R998; n998: number }
function make998(): O998 { return { in998: { a998: 1, m998: () => 1 }, n998: 2 }; }
function c998(): void { say("nested/set-iteration/strict-eq", ([...new Set([make998().in998.m998])][0]) === ([...new Set([make998().in998.m998])][0])); }

interface R999 { a999: number; m999: () => number }
interface O999 { in999: R999; n999: number }
function make999(): O999 { return { in999: { a999: 1, m999: () => 1 }, n999: 2 }; }
function c999(): void { say("nested/map-get/strict-eq", (new Map([[1, make999().in999.m999]]).get(1)) === (new Map([[1, make999().in999.m999]]).get(1))); }

interface R1000 { a1000: number; m1000: () => number }
interface O1000 { in1000: R1000; n1000: number }
function make1000(): O1000 { return { in1000: { a1000: 1, m1000: () => 1 }, n1000: 2 }; }
function self1000(this: unknown): unknown { return this; }
function c1000(): void { say("nested/bind-this/strict-eq", (self1000.bind(make1000().in1000.m1000)()) === (self1000.bind(make1000().in1000.m1000)())); }

interface R1001 { a1001: number; m1001: () => number }
interface O1001 { in1001: R1001; n1001: number }
function make1001(): O1001 { return { in1001: { a1001: 1, m1001: () => 1 }, n1001: 2 }; }
function self1001(this: unknown): unknown { return this; }
function c1001(): void { say("nested/call-this/strict-eq", (self1001.call(make1001().in1001.m1001)) === (self1001.call(make1001().in1001.m1001))); }

interface R1002 { a1002: number; m1002: () => number }
interface O1002 { in1002: R1002; n1002: number }
function make1002(): O1002 { return { in1002: { a1002: 1, m1002: () => 1 }, n1002: 2 }; }
function first1002(x: unknown): unknown { return x; }
function c1002(): void { say("nested/apply-arguments/strict-eq", (first1002.apply(null, [make1002().in1002.m1002])) === (first1002.apply(null, [make1002().in1002.m1002]))); }

interface R1003 { a1003: number; m1003: () => number }
interface O1003 { in1003: R1003; n1003: number }
function make1003(): O1003 { return { in1003: { a1003: 1, m1003: () => 1 }, n1003: 2 }; }
function first1003(x: unknown): unknown { return x; }
function c1003(): void { say("nested/reflect-apply/strict-eq", (Reflect.apply(first1003, null, [make1003().in1003.m1003])) === (Reflect.apply(first1003, null, [make1003().in1003.m1003]))); }

interface R1004 { a1004: number; m1004: () => number }
interface O1004 { in1004: R1004; n1004: number }
function make1004(): O1004 { return { in1004: { a1004: 1, m1004: () => 1 }, n1004: 2 }; }
function c1004(): void { say("nested/logical-or/strict-eq", (((0 as unknown) || make1004().in1004.m1004)) === (((0 as unknown) || make1004().in1004.m1004))); }

interface R1005 { a1005: number; m1005: () => number }
interface O1005 { in1005: R1005; n1005: number }
function make1005(): O1005 { return { in1005: { a1005: 1, m1005: () => 1 }, n1005: 2 }; }
let none1005: unknown;
function c1005(): void { say("nested/nullish/strict-eq", ((none1005 ?? make1005().in1005.m1005)) === ((none1005 ?? make1005().in1005.m1005))); }

interface R1006 { a1006: number; m1006: () => number }
interface O1006 { in1006: R1006; n1006: number }
function make1006(): O1006 { return { in1006: { a1006: 1, m1006: () => 1 }, n1006: 2 }; }
function c1006(): void { say("nested/comma/strict-eq", ((out.length, make1006().in1006.m1006)) === ((out.length, make1006().in1006.m1006))); }

interface R1007 { a1007: number; m1007: () => number }
interface O1007 { in1007: R1007; n1007: number }
function make1007(): O1007 { return { in1007: { a1007: 1, m1007: () => 1 }, n1007: 2 }; }
function c1007(): void { say("nested/computed-member/strict-eq", (({ ["k"]: make1007().in1007.m1007 })["k"]) === (({ ["k"]: make1007().in1007.m1007 })["k"])); }

interface R1008 { a1008: number; m1008: () => number }
interface O1008 { in1008: R1008; n1008: number }
function make1008(): O1008 { return { in1008: { a1008: 1, m1008: () => 1 }, n1008: 2 }; }
const s1008 = Symbol();
function c1008(): void { say("nested/symbol-member/strict-eq", (({ [s1008]: make1008().in1008.m1008 })[s1008]) === (({ [s1008]: make1008().in1008.m1008 })[s1008])); }

interface R1009 { a1009: number; m1009: () => number }
interface O1009 { in1009: R1009; n1009: number }
function make1009(): O1009 { return { in1009: { a1009: 1, m1009: () => 1 }, n1009: 2 }; }
function c1009(): void { say("nested/getter-member/strict-eq", (({ get f(): unknown { return make1009().in1009.m1009; } }).f) === (({ get f(): unknown { return make1009().in1009.m1009; } }).f)); }

interface R1010 { a1010: number; m1010: () => number }
interface O1010 { in1010: R1010; n1010: number }
function make1010(): O1010 { return { in1010: { a1010: 1, m1010: () => 1 }, n1010: 2 }; }
function c1010(): void { say("nested/proxy-get/strict-eq", (new Proxy({ f: make1010().in1010.m1010 as unknown }, {}).f) === (new Proxy({ f: make1010().in1010.m1010 as unknown }, {}).f)); }

interface R1011 { a1011: number; m1011: () => number }
interface O1011 { in1011: R1011; n1011: number }
function make1011(): O1011 { return { in1011: { a1011: 1, m1011: () => 1 }, n1011: 2 }; }
function c1011(): void { say("nested/prototype-chain/strict-eq", (Object.create({ f: make1011().in1011.m1011 }).f) === (Object.create({ f: make1011().in1011.m1011 }).f)); }

interface R1012 { a1012: number; m1012: () => number }
interface O1012 { in1012: R1012; n1012: number }
function make1012(): O1012 { return { in1012: { a1012: 1, m1012: () => 1 }, n1012: 2 }; }
function c1012(): void { say("nested/weak-ref/strict-eq", (new WeakRef(make1012().in1012.m1012 as object).deref()) === (new WeakRef(make1012().in1012.m1012 as object).deref())); }

interface R1013 { a1013: number; m1013: () => number }
interface O1013 { in1013: R1013; n1013: number }
function make1013(): O1013 { return { in1013: { a1013: 1, m1013: () => 1 }, n1013: 2 }; }
function get1013(_x: unknown): unknown { return arguments[0]; }
function c1013(): void { say("nested/arguments-object/strict-eq", (get1013(make1013().in1013.m1013)) === (get1013(make1013().in1013.m1013))); }

interface R1014 { a1014: number; m1014: () => number }
interface O1014 { in1014: R1014; n1014: number }
function make1014(): O1014 { return { in1014: { a1014: 1, m1014: () => 1 }, n1014: 2 }; }
function get1014(n: number): unknown { return n === 0 ? make1014().in1014.m1014 : get1014(n - 1); }
function c1014(): void { say("nested/recursion/strict-eq", (get1014(2)) === (get1014(2))); }

interface R1015 { a1015: number; m1015: () => number }
interface O1015 { in1015: R1015; n1015: number }
function make1015(): O1015 { return { in1015: { a1015: 1, m1015: () => 1 }, n1015: 2 }; }
function even1015(n: number): unknown { return n === 0 ? make1015().in1015.m1015 : odd1015(n - 1); }
function odd1015(n: number): unknown { return even1015(n - 1); }
function c1015(): void { say("nested/mutual-recursion/strict-eq", (even1015(2)) === (even1015(2))); }

interface R1016 { a1016: number; m1016: () => number }
interface O1016 { in1016: R1016; n1016: number }
function make1016(): O1016 { return { in1016: { a1016: 1, m1016: () => 1 }, n1016: 2 }; }
function again1016(): O1016 { return make1016(); }
function c1016(): void { say("nested/maker-forwarded/strict-eq", (again1016().in1016.m1016) === (again1016().in1016.m1016)); }

interface R1017 { a1017: number; m1017: () => number }
interface O1017 { in1017: R1017; n1017: number }
function make1017(): O1017 { return { in1017: { a1017: 1, m1017: () => 1 }, n1017: 2 }; }
function again1017(): O1017 { return make1017(); }
function get1017(): unknown { return again1017().in1017.m1017; }
function c1017(): void { say("nested/maker-forwarded-and-returned/strict-eq", (get1017()) === (get1017())); }

interface R1018 { a1018: number; m1018: () => number }
interface O1018 { in1018: R1018; n1018: number }
function make1018(): O1018 { return { in1018: { a1018: 1, m1018: () => 1 }, n1018: 2 }; }
function build1018(f: () => O1018): O1018 { return f(); }
function c1018(): void { say("nested/maker-as-a-callback/strict-eq", (build1018(make1018).in1018.m1018) === (build1018(make1018).in1018.m1018)); }

interface R1019 { a1019: number; m1019: () => number }
interface O1019 { in1019: R1019; n1019: number }
function make1019(): O1019 { return { in1019: { a1019: 1, m1019: () => 1 }, n1019: 2 }; }
function build1019(f: () => O1019): O1019 { return f(); }
function get1019(): unknown { return build1019(make1019).in1019.m1019; }
function c1019(): void { say("nested/maker-as-a-callback-returned/strict-eq", (get1019()) === (get1019())); }

interface R1020 { a1020: number; m1020: () => number }
interface O1020 { in1020: R1020; n1020: number }
function make1020(): O1020 { return { in1020: { a1020: 1, m1020: () => 1 }, n1020: 2 }; }
function box1020(): { t: O1020 } { return { t: make1020() }; }
function get1020(): unknown { return box1020().t.in1020.m1020; }
function c1020(): void { say("nested/holder-through-a-record/strict-eq", (get1020()) === (get1020())); }

c961(); c962(); c963(); c964(); c965(); c966(); c967(); c968(); c969(); c970(); c971(); c972(); c973(); c974(); c975(); c976(); c977(); c978(); c979(); c980(); c981(); c982(); c983(); c984(); c985(); c986(); c987(); c988(); c989(); c990(); c991(); c992(); c993(); c994(); c995(); c996(); c997(); c998(); c999(); c1000(); c1001(); c1002(); c1003(); c1004(); c1005(); c1006(); c1007(); c1008(); c1009(); c1010(); c1011(); c1012(); c1013(); c1014(); c1015(); c1016(); c1017(); c1018(); c1019(); c1020();
console.log(out.join("\n"));
