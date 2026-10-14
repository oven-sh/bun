// Generated program: object and closure identity stays observable when allocations are removed (second series, part 15).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R901 { a901: number; m901: () => number }
function make901(): R901 { return { a901: 1, m901: () => 1 }; }
function get901(): unknown { try { return make901().m901; } finally { out.length; } }
function c901(): void { say("record/finally/strict-eq", (get901()) === (get901())); }

interface R902 { a902: number; m902: () => number }
function make902(): R902 { return { a902: 1, m902: () => 1 }; }
function get902(): unknown { try { return make902().m902; } finally { out.length; } }
function c902(): void { say("record/finally/strict-ne", (get902()) !== (get902())); }

interface R903 { a903: number; m903: () => number }
function make903(): R903 { return { a903: 1, m903: () => 1 }; }
function get903(): unknown { try { return make903().m903; } finally { out.length; } }
function c903(): void { say("record/finally/loose-eq", (get903()) == (get903())); }

interface R904 { a904: number; m904: () => number }
function make904(): R904 { return { a904: 1, m904: () => 1 }; }
function get904(): unknown { try { return make904().m904; } finally { out.length; } }
function c904(): void { say("record/finally/object-is", Object.is((get904()), (get904()))); }

interface R905 { a905: number; m905: () => number }
function make905(): R905 { return { a905: 1, m905: () => 1 }; }
function get905(): unknown { try { return make905().m905; } finally { out.length; } }
function c905(): void { say("record/finally/set", new Set([(get905()), (get905())]).size); }

interface R906 { a906: number; m906: () => number }
function make906(): R906 { return { a906: 1, m906: () => 1 }; }
function get906(): unknown { try { return make906().m906; } finally { out.length; } }
function c906(): void { say("record/finally/map-key", new Map([[(get906()), 1], [(get906()), 2]]).size); }

interface R907 { a907: number; m907: () => number }
function make907(): R907 { return { a907: 1, m907: () => 1 }; }
function get907(): unknown { try { return make907().m907; } finally { out.length; } }
function c907(): void { say("record/finally/includes", [(get907())].includes((get907()))); }

interface R908 { a908: number; m908: () => number }
function make908(): R908 { return { a908: 1, m908: () => 1 }; }
function get908(): unknown { try { return make908().m908; } finally { out.length; } }
function c908(): void { say("record/finally/index-of", [(get908())].indexOf((get908()))); }

interface R909 { a909: number; m909: () => number }
function make909(): R909 { return { a909: 1, m909: () => 1 }; }
function get909(): unknown { try { return make909().m909; } finally { out.length; } }
const ws909 = new WeakSet<object>();
function c909(): void { say("record/finally/weak-set", (ws909.add((get909()) as object), ws909.has((get909()) as object))); }

interface R910 { a910: number; m910: () => number }
function make910(): R910 { return { a910: 1, m910: () => 1 }; }
function get910(): unknown { try { return make910().m910; } finally { out.length; } }
const wm910 = new WeakMap<object, number>();
function c910(): void { say("record/finally/weak-map", (wm910.set((get910()) as object, 1), wm910.has((get910()) as object))); }

interface R911 { a911: number; m911: () => number }
function make911(): R911 { return { a911: 1, m911: () => 1 }; }
function get911(): unknown { try { return make911().m911; } finally { out.length; } }
function c911(): void { say("record/finally/written", ((((get911())) as any).tag = 1, (((get911())) as any).tag)); }

interface R912 { a912: number; m912: () => number }
function make912(): R912 { return { a912: 1, m912: () => 1 }; }
function get912(): unknown { try { return make912().m912; } finally { out.length; } }
function c912(): void { say("record/finally/defined", (Object.defineProperty((get912()) as object, "t", { value: 1 }), "t" in ((get912()) as object))); }

interface R913 { a913: number; m913: () => number }
function make913(): R913 { return { a913: 1, m913: () => 1 }; }
function get913(): unknown { try { return make913().m913; } finally { out.length; } }
function c913(): void { say("record/finally/frozen", (Object.freeze((get913())), Object.isFrozen((get913())))); }

interface R914 { a914: number; m914: () => number }
function make914(): R914 { return { a914: 1, m914: () => 1 }; }
function get914(): unknown { try { return make914().m914; } finally { out.length; } }
function c914(): void { say("record/finally/prototype-set", (Object.setPrototypeOf((get914()) as object, null), Object.getPrototypeOf((get914())) === null)); }

interface R915 { a915: number; m915: () => number }
function make915(): R915 { return { a915: 1, m915: () => 1 }; }
function get915(): unknown { try { return make915().m915; } finally { out.length; } }
function c915(): void { say("record/finally/deleted", (delete (((get915())) as any).length, Object.hasOwn((get915()) as object, "length"))); }

interface R916 { a916: number; m916: () => number }
function make916(): R916 { return { a916: 1, m916: () => 1 }; }
function get916(): unknown { try { return make916().m916; } finally { out.length; } }
function same916(a: unknown, b: unknown): boolean { return a === b; }
function c916(): void { say("record/finally/in-a-callee", same916((get916()), (get916()))); }

interface R917 { a917: number; m917: () => number }
function make917(): R917 { return { a917: 1, m917: () => 1 }; }
function get917(): unknown { try { return make917().m917; } finally { out.length; } }
function hit917(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c917(): void { say("record/finally/switch", hit917((get917()), (get917()))); }

interface R918 { a918: number; m918: () => number }
function make918(): R918 { return { a918: 1, m918: () => 1 }; }
function get918(): unknown { try { return make918().m918; } finally { out.length; } }
let last918: unknown;
function seen918(f: unknown): boolean { const same = f === last918; last918 = f; return same; }
function c918(): void { say("record/finally/kept-then-compared", (seen918((get918())), seen918((get918())))); }

interface R919 { a919: number; m919: () => number }
function make919(): R919 { return { a919: 1, m919: () => 1 }; }
function get919(n: number): unknown { switch (n) { case 1: return make919().m919; default: return 0; } }
function c919(): void { say("record/switch-arm/strict-eq", (get919(1)) === (get919(1))); }

interface R920 { a920: number; m920: () => number }
function make920(): R920 { return { a920: 1, m920: () => 1 }; }
function get920(n: number): unknown { switch (n) { case 1: return make920().m920; default: return 0; } }
function c920(): void { say("record/switch-arm/strict-ne", (get920(1)) !== (get920(1))); }

interface R921 { a921: number; m921: () => number }
function make921(): R921 { return { a921: 1, m921: () => 1 }; }
function get921(n: number): unknown { switch (n) { case 1: return make921().m921; default: return 0; } }
function c921(): void { say("record/switch-arm/loose-eq", (get921(1)) == (get921(1))); }

interface R922 { a922: number; m922: () => number }
function make922(): R922 { return { a922: 1, m922: () => 1 }; }
function get922(n: number): unknown { switch (n) { case 1: return make922().m922; default: return 0; } }
function c922(): void { say("record/switch-arm/object-is", Object.is((get922(1)), (get922(1)))); }

interface R923 { a923: number; m923: () => number }
function make923(): R923 { return { a923: 1, m923: () => 1 }; }
function get923(n: number): unknown { switch (n) { case 1: return make923().m923; default: return 0; } }
function c923(): void { say("record/switch-arm/set", new Set([(get923(1)), (get923(1))]).size); }

interface R924 { a924: number; m924: () => number }
function make924(): R924 { return { a924: 1, m924: () => 1 }; }
function get924(n: number): unknown { switch (n) { case 1: return make924().m924; default: return 0; } }
function c924(): void { say("record/switch-arm/map-key", new Map([[(get924(1)), 1], [(get924(1)), 2]]).size); }

interface R925 { a925: number; m925: () => number }
function make925(): R925 { return { a925: 1, m925: () => 1 }; }
function get925(n: number): unknown { switch (n) { case 1: return make925().m925; default: return 0; } }
function c925(): void { say("record/switch-arm/includes", [(get925(1))].includes((get925(1)))); }

interface R926 { a926: number; m926: () => number }
function make926(): R926 { return { a926: 1, m926: () => 1 }; }
function get926(n: number): unknown { switch (n) { case 1: return make926().m926; default: return 0; } }
function c926(): void { say("record/switch-arm/index-of", [(get926(1))].indexOf((get926(1)))); }

interface R927 { a927: number; m927: () => number }
function make927(): R927 { return { a927: 1, m927: () => 1 }; }
function get927(n: number): unknown { switch (n) { case 1: return make927().m927; default: return 0; } }
const ws927 = new WeakSet<object>();
function c927(): void { say("record/switch-arm/weak-set", (ws927.add((get927(1)) as object), ws927.has((get927(1)) as object))); }

interface R928 { a928: number; m928: () => number }
function make928(): R928 { return { a928: 1, m928: () => 1 }; }
function get928(n: number): unknown { switch (n) { case 1: return make928().m928; default: return 0; } }
const wm928 = new WeakMap<object, number>();
function c928(): void { say("record/switch-arm/weak-map", (wm928.set((get928(1)) as object, 1), wm928.has((get928(1)) as object))); }

interface R929 { a929: number; m929: () => number }
function make929(): R929 { return { a929: 1, m929: () => 1 }; }
function get929(n: number): unknown { switch (n) { case 1: return make929().m929; default: return 0; } }
function c929(): void { say("record/switch-arm/written", ((((get929(1))) as any).tag = 1, (((get929(1))) as any).tag)); }

interface R930 { a930: number; m930: () => number }
function make930(): R930 { return { a930: 1, m930: () => 1 }; }
function get930(n: number): unknown { switch (n) { case 1: return make930().m930; default: return 0; } }
function c930(): void { say("record/switch-arm/defined", (Object.defineProperty((get930(1)) as object, "t", { value: 1 }), "t" in ((get930(1)) as object))); }

interface R931 { a931: number; m931: () => number }
function make931(): R931 { return { a931: 1, m931: () => 1 }; }
function get931(n: number): unknown { switch (n) { case 1: return make931().m931; default: return 0; } }
function c931(): void { say("record/switch-arm/frozen", (Object.freeze((get931(1))), Object.isFrozen((get931(1))))); }

interface R932 { a932: number; m932: () => number }
function make932(): R932 { return { a932: 1, m932: () => 1 }; }
function get932(n: number): unknown { switch (n) { case 1: return make932().m932; default: return 0; } }
function c932(): void { say("record/switch-arm/prototype-set", (Object.setPrototypeOf((get932(1)) as object, null), Object.getPrototypeOf((get932(1))) === null)); }

interface R933 { a933: number; m933: () => number }
function make933(): R933 { return { a933: 1, m933: () => 1 }; }
function get933(n: number): unknown { switch (n) { case 1: return make933().m933; default: return 0; } }
function c933(): void { say("record/switch-arm/deleted", (delete (((get933(1))) as any).length, Object.hasOwn((get933(1)) as object, "length"))); }

interface R934 { a934: number; m934: () => number }
function make934(): R934 { return { a934: 1, m934: () => 1 }; }
function get934(n: number): unknown { switch (n) { case 1: return make934().m934; default: return 0; } }
function same934(a: unknown, b: unknown): boolean { return a === b; }
function c934(): void { say("record/switch-arm/in-a-callee", same934((get934(1)), (get934(1)))); }

interface R935 { a935: number; m935: () => number }
function make935(): R935 { return { a935: 1, m935: () => 1 }; }
function get935(n: number): unknown { switch (n) { case 1: return make935().m935; default: return 0; } }
function hit935(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c935(): void { say("record/switch-arm/switch", hit935((get935(1)), (get935(1)))); }

interface R936 { a936: number; m936: () => number }
function make936(): R936 { return { a936: 1, m936: () => 1 }; }
function get936(n: number): unknown { switch (n) { case 1: return make936().m936; default: return 0; } }
let last936: unknown;
function seen936(f: unknown): boolean { const same = f === last936; last936 = f; return same; }
function c936(): void { say("record/switch-arm/kept-then-compared", (seen936((get936(1))), seen936((get936(1))))); }

interface R937 { a937: number; m937: () => number }
function make937(): R937 { return { a937: 1, m937: () => 1 }; }
function c937(): void { say("record/object-from-entries/strict-eq", (Object.fromEntries([["k", make937().m937]]).k) === (Object.fromEntries([["k", make937().m937]]).k)); }

interface R938 { a938: number; m938: () => number }
function make938(): R938 { return { a938: 1, m938: () => 1 }; }
function c938(): void { say("record/object-from-entries/strict-ne", (Object.fromEntries([["k", make938().m938]]).k) !== (Object.fromEntries([["k", make938().m938]]).k)); }

interface R939 { a939: number; m939: () => number }
function make939(): R939 { return { a939: 1, m939: () => 1 }; }
function c939(): void { say("record/object-from-entries/loose-eq", (Object.fromEntries([["k", make939().m939]]).k) == (Object.fromEntries([["k", make939().m939]]).k)); }

interface R940 { a940: number; m940: () => number }
function make940(): R940 { return { a940: 1, m940: () => 1 }; }
function c940(): void { say("record/object-from-entries/object-is", Object.is((Object.fromEntries([["k", make940().m940]]).k), (Object.fromEntries([["k", make940().m940]]).k))); }

interface R941 { a941: number; m941: () => number }
function make941(): R941 { return { a941: 1, m941: () => 1 }; }
function c941(): void { say("record/object-from-entries/set", new Set([(Object.fromEntries([["k", make941().m941]]).k), (Object.fromEntries([["k", make941().m941]]).k)]).size); }

interface R942 { a942: number; m942: () => number }
function make942(): R942 { return { a942: 1, m942: () => 1 }; }
function c942(): void { say("record/object-from-entries/map-key", new Map([[(Object.fromEntries([["k", make942().m942]]).k), 1], [(Object.fromEntries([["k", make942().m942]]).k), 2]]).size); }

interface R943 { a943: number; m943: () => number }
function make943(): R943 { return { a943: 1, m943: () => 1 }; }
function c943(): void { say("record/object-from-entries/includes", [(Object.fromEntries([["k", make943().m943]]).k)].includes((Object.fromEntries([["k", make943().m943]]).k))); }

interface R944 { a944: number; m944: () => number }
function make944(): R944 { return { a944: 1, m944: () => 1 }; }
function c944(): void { say("record/object-from-entries/index-of", [(Object.fromEntries([["k", make944().m944]]).k)].indexOf((Object.fromEntries([["k", make944().m944]]).k))); }

interface R945 { a945: number; m945: () => number }
function make945(): R945 { return { a945: 1, m945: () => 1 }; }
const ws945 = new WeakSet<object>();
function c945(): void { say("record/object-from-entries/weak-set", (ws945.add((Object.fromEntries([["k", make945().m945]]).k) as object), ws945.has((Object.fromEntries([["k", make945().m945]]).k) as object))); }

interface R946 { a946: number; m946: () => number }
function make946(): R946 { return { a946: 1, m946: () => 1 }; }
const wm946 = new WeakMap<object, number>();
function c946(): void { say("record/object-from-entries/weak-map", (wm946.set((Object.fromEntries([["k", make946().m946]]).k) as object, 1), wm946.has((Object.fromEntries([["k", make946().m946]]).k) as object))); }

interface R947 { a947: number; m947: () => number }
function make947(): R947 { return { a947: 1, m947: () => 1 }; }
function c947(): void { say("record/object-from-entries/written", ((((Object.fromEntries([["k", make947().m947]]).k)) as any).tag = 1, (((Object.fromEntries([["k", make947().m947]]).k)) as any).tag)); }

interface R948 { a948: number; m948: () => number }
function make948(): R948 { return { a948: 1, m948: () => 1 }; }
function c948(): void { say("record/object-from-entries/defined", (Object.defineProperty((Object.fromEntries([["k", make948().m948]]).k) as object, "t", { value: 1 }), "t" in ((Object.fromEntries([["k", make948().m948]]).k) as object))); }

interface R949 { a949: number; m949: () => number }
function make949(): R949 { return { a949: 1, m949: () => 1 }; }
function c949(): void { say("record/object-from-entries/frozen", (Object.freeze((Object.fromEntries([["k", make949().m949]]).k)), Object.isFrozen((Object.fromEntries([["k", make949().m949]]).k)))); }

interface R950 { a950: number; m950: () => number }
function make950(): R950 { return { a950: 1, m950: () => 1 }; }
function c950(): void { say("record/object-from-entries/prototype-set", (Object.setPrototypeOf((Object.fromEntries([["k", make950().m950]]).k) as object, null), Object.getPrototypeOf((Object.fromEntries([["k", make950().m950]]).k)) === null)); }

interface R951 { a951: number; m951: () => number }
function make951(): R951 { return { a951: 1, m951: () => 1 }; }
function c951(): void { say("record/object-from-entries/deleted", (delete (((Object.fromEntries([["k", make951().m951]]).k)) as any).length, Object.hasOwn((Object.fromEntries([["k", make951().m951]]).k) as object, "length"))); }

interface R952 { a952: number; m952: () => number }
function make952(): R952 { return { a952: 1, m952: () => 1 }; }
function same952(a: unknown, b: unknown): boolean { return a === b; }
function c952(): void { say("record/object-from-entries/in-a-callee", same952((Object.fromEntries([["k", make952().m952]]).k), (Object.fromEntries([["k", make952().m952]]).k))); }

interface R953 { a953: number; m953: () => number }
function make953(): R953 { return { a953: 1, m953: () => 1 }; }
function hit953(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c953(): void { say("record/object-from-entries/switch", hit953((Object.fromEntries([["k", make953().m953]]).k), (Object.fromEntries([["k", make953().m953]]).k))); }

interface R954 { a954: number; m954: () => number }
function make954(): R954 { return { a954: 1, m954: () => 1 }; }
let last954: unknown;
function seen954(f: unknown): boolean { const same = f === last954; last954 = f; return same; }
function c954(): void { say("record/object-from-entries/kept-then-compared", (seen954((Object.fromEntries([["k", make954().m954]]).k)), seen954((Object.fromEntries([["k", make954().m954]]).k)))); }

interface R955 { a955: number; m955: () => number }
function make955(): R955 { return { a955: 1, m955: () => 1 }; }
function get955(): unknown { const t = make955(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m955; }
function c955(): void { say("record/structured-holder/strict-eq", (get955()) === (get955())); }

interface R956 { a956: number; m956: () => number }
function make956(): R956 { return { a956: 1, m956: () => 1 }; }
function get956(): unknown { const t = make956(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m956; }
function c956(): void { say("record/structured-holder/strict-ne", (get956()) !== (get956())); }

interface R957 { a957: number; m957: () => number }
function make957(): R957 { return { a957: 1, m957: () => 1 }; }
function get957(): unknown { const t = make957(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m957; }
function c957(): void { say("record/structured-holder/loose-eq", (get957()) == (get957())); }

interface R958 { a958: number; m958: () => number }
function make958(): R958 { return { a958: 1, m958: () => 1 }; }
function get958(): unknown { const t = make958(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m958; }
function c958(): void { say("record/structured-holder/object-is", Object.is((get958()), (get958()))); }

interface R959 { a959: number; m959: () => number }
function make959(): R959 { return { a959: 1, m959: () => 1 }; }
function get959(): unknown { const t = make959(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m959; }
function c959(): void { say("record/structured-holder/set", new Set([(get959()), (get959())]).size); }

interface R960 { a960: number; m960: () => number }
function make960(): R960 { return { a960: 1, m960: () => 1 }; }
function get960(): unknown { const t = make960(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m960; }
function c960(): void { say("record/structured-holder/map-key", new Map([[(get960()), 1], [(get960()), 2]]).size); }

c901(); c902(); c903(); c904(); c905(); c906(); c907(); c908(); c909(); c910(); c911(); c912(); c913(); c914(); c915(); c916(); c917(); c918(); c919(); c920(); c921(); c922(); c923(); c924(); c925(); c926(); c927(); c928(); c929(); c930(); c931(); c932(); c933(); c934(); c935(); c936(); c937(); c938(); c939(); c940(); c941(); c942(); c943(); c944(); c945(); c946(); c947(); c948(); c949(); c950(); c951(); c952(); c953(); c954(); c955(); c956(); c957(); c958(); c959(); c960();
console.log(out.join("\n"));
