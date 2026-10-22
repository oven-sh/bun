// Each function is found by one way alone, and is called by value.
const results = [];
function attempt(name, body) { try { results.push(name + ': ' + String(body())); } catch (error) { results.push(name + ': ' + error.name + ': ' + String(error.message).slice(0, 60)); } }
function found1() { return 'ok 1'; }
attempt('Object.assign onto a class', () => { class A { static f() { return 'old'; } } Object.assign(A, { f: found1 }); return A.f(); });
function found2() { return 'ok 2'; }
attempt('Object.assign onto a static field', () => { class A { static f = null; } Object.assign(A, { f: found2 }); return A.f(); });
function found3() { return 'ok 3'; }
attempt('Object.assign onto a function', () => { function h() {} Object.assign(h, { f: found3 }); return h.f(); });
function found4() { return 'ok 4'; }
attempt('Object.assign onto a prototype', () => { class A {} Object.assign(A.prototype, { f: found4 }); return new A().f(); });
function found5() { return 'ok 5'; }
attempt('Object.assign onto an instance', () => { class A { f = null; } const a = new A(); Object.assign(a, { f: found5 }); return a.f(); });
function found6() { return 'ok 6'; }
attempt('Object.assign of two sources', () => { const o = Object.assign({}, { g: 1 }, { f: found6 }); return o.f(); });
function found7() { return 'ok 7'; }
attempt('Object.assign answers its target', () => { return Object.assign({}, { f: found7 }).f(); });
function found8() { return 'ok 8'; }
attempt('spread', () => { const o = { ...{ f: found8 } }; return o.f(); });
function found9() { return 'ok 9'; }
attempt('spread of a spread', () => { const o = { ...{ ...{ f: found9 } } }; return o.f(); });
function found10() { return 'ok 10'; }
attempt('rest of an object pattern', () => { const { a, ...rest } = { a: 1, f: found10 }; return rest.f(); });
function found11() { return 'ok 11'; }
attempt('defineProperties', () => { const o = {}; Object.defineProperties(o, { f: { value: found11 } }); return o.f(); });
function found12() { return 'ok 12'; }
attempt('defineProperty with a computed name', () => { const o = {}; Object.defineProperty(o, 'f' + '', { value: found12 }); return o.f(); });
function found13() { return 'ok 13'; }
attempt('descriptors copied', () => { const o = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ f: found13 })); return o.f(); });
function found14() { return 'ok 14'; }
attempt('Object.create with descriptors', () => { const o = Object.create(null, { f: { value: found14 } }); return o.f(); });
function found15() { return 'ok 15'; }
attempt('Object.create above', () => { const o = Object.create({ f: found15 }); return o.f(); });
function found16() { return 'ok 16'; }
attempt('setPrototypeOf', () => { const o = Object.setPrototypeOf({}, { f: found16 }); return o.f(); });
function found17() { return 'ok 17'; }
attempt('__proto__ in a literal', () => { const o = { __proto__: { f: found17 } }; return o.f(); });
function found18() { return 'ok 18'; }
attempt('__proto__ stored', () => { const o = {}; o.__proto__ = { f: found18 }; return o.f(); });
function found19() { return 'ok 19'; }
attempt('Reflect.set', () => { const o = {}; Reflect.set(o, 'f', found19); return o.f(); });
function found20() { return 'ok 20'; }
attempt('Reflect.defineProperty', () => { const o = {}; Reflect.defineProperty(o, 'f', { value: found20 }); return o.f(); });
function found21() { return 'ok 21'; }
attempt('Reflect.get', () => { return Reflect.get({ f: found21 }, 'f')(); });
function found22() { return 'ok 22'; }
attempt('Reflect.apply', () => { return Reflect.apply(found22, undefined, []); });
function found23() { return 'ok 23'; }
attempt('Reflect.construct', () => { return typeof Reflect.construct(found23, []); });
function found24() { return 'ok 24'; }
attempt('call', () => { return found24.call(null); });
function found25() { return 'ok 25'; }
attempt('apply', () => { return found25.apply(null, []); });
function found26() { return 'ok 26'; }
attempt('bind', () => { return found26.bind(null)(); });
function found27() { return 'ok 27'; }
attempt('bind of bind', () => { return found27.bind(null).bind(null)(); });
function found28() { return 'ok 28'; }
attempt('call.call', () => { return Function.prototype.call.call(found28); });
function found29() { return 'ok 29'; }
attempt('fromEntries', () => { return Object.fromEntries([['f', found29]]).f(); });
function found30() { return 'ok 30'; }
attempt('fromEntries of a Map', () => { return Object.fromEntries(new Map([['f', found30]])).f(); });
function found31() { return 'ok 31'; }
attempt('entries', () => { return Object.entries({ f: found31 })[0][1](); });
function found32() { return 'ok 32'; }
attempt('values', () => { return Object.values({ f: found32 })[0](); });
function found33() { return 'ok 33'; }
attempt('for in copy', () => { const s = { f: found33 }, o = {}; for (const k in s) o[k] = s[k]; return o.f(); });
function found34() { return 'ok 34'; }
attempt('keys copy', () => { const s = { f: found34 }, o = {}; for (const k of Object.keys(s)) o[k] = s[k]; return o.f(); });
function found35() { return 'ok 35'; }
attempt('getOwnPropertyDescriptor', () => { return Object.getOwnPropertyDescriptor({ f: found35 }, 'f').value(); });
function found36() { return 'ok 36'; }
attempt('getter', () => { return ({ get f() { return found36; } }).f(); });
function found37() { return 'ok 37'; }
attempt('__defineGetter__', () => { const o = {}; o.__defineGetter__('f', () => found37); return o.f(); });
function found38() { return 'ok 38'; }
attempt('__lookupGetter__', () => { return ({ get f() { return 1; }, g: 0 }).__lookupGetter__('f').name + Object.getOwnPropertyDescriptor({ get x() { return found38(); } }, 'x').get(); });
function found39() { return 'ok 39'; }
attempt('setter is called', () => { let r; const o = Object.defineProperty({}, 'x', { set(v) { r = found39(); } }); o.x = 1; return r; });
function found40() { return 'ok 40'; }
attempt('freeze', () => { return Object.freeze({ f: found40 }).f(); });
function found41() { return 'ok 41'; }
attempt('array at', () => { return [found41].at(0)(); });
function found42() { return 'ok 42'; }
attempt('array slice', () => { return [found42].slice()[0](); });
function found43() { return 'ok 43'; }
attempt('array concat', () => { return [].concat([found43])[0](); });
function found44() { return 'ok 44'; }
attempt('array flat', () => { return [[found44]].flat()[0](); });
function found45() { return 'ok 45'; }
attempt('array flatMap', () => { return [0].flatMap(() => [found45])[0](); });
function found46() { return 'ok 46'; }
attempt('array of', () => { return Array.of(found46)[0](); });
function found47() { return 'ok 47'; }
attempt('array from', () => { return Array.from([found47])[0](); });
function found48() { return 'ok 48'; }
attempt('array from a set', () => { return Array.from(new Set([found48]))[0](); });
function found49() { return 'ok 49'; }
attempt('array from array-like', () => { return Array.from({ length: 1, 0: found49 })[0](); });
function found50() { return 'ok 50'; }
attempt('array from with a mapper', () => { return Array.from({ length: 1 }, found50)[0]; });
function found51() { return 'ok 51'; }
attempt('array spread', () => { return [...[found51]][0](); });
function found52() { return 'ok 52'; }
attempt('array toReversed', () => { return [found52].toReversed()[0](); });
function found53() { return 'ok 53'; }
attempt('array toSorted', () => { return [found53].toSorted()[0](); });
function found54() { return 'ok 54'; }
attempt('array toSpliced', () => { return [found54].toSpliced(1, 0)[0](); });
function found55() { return 'ok 55'; }
attempt('array with', () => { return [0].with(0, found55)[0](); });
function found56() { return 'ok 56'; }
attempt('array filter', () => { return [found56].filter(Boolean)[0](); });
function found57() { return 'ok 57'; }
attempt('array map', () => { return [found57].map(x => x)[0](); });
function found58() { return 'ok 58'; }
attempt('array find', () => { return [found58].find(Boolean)(); });
function found59() { return 'ok 59'; }
attempt('array findLast', () => { return [found59].findLast(Boolean)(); });
function found60() { return 'ok 60'; }
attempt('array reduce', () => { return [found60].reduce((a, b) => b, null)(); });
function found61() { return 'ok 61'; }
attempt('array reduce without a start', () => { return [found61].reduce((a, b) => b)(); });
function found62() { return 'ok 62'; }
attempt('array pop', () => { return [found62].pop()(); });
function found63() { return 'ok 63'; }
attempt('array shift', () => { return [found63].shift()(); });
function found64() { return 'ok 64'; }
attempt('array splice', () => { return [found64].splice(0, 1)[0](); });
function found65() { return 'ok 65'; }
attempt('array fill', () => { return new Array(1).fill(found65)[0](); });
function found66() { return 'ok 66'; }
attempt('array push', () => { const a = []; a.push(found66); return a[0](); });
function found67() { return 'ok 67'; }
attempt('array unshift', () => { const a = []; a.unshift(found67); return a[0](); });
function found68() { return 'ok 68'; }
attempt('array copyWithin', () => { return [found68, 0].copyWithin(1, 0)[1](); });
function found69() { return 'ok 69'; }
attempt('array values', () => { return [found69].values().next().value(); });
function found70() { return 'ok 70'; }
attempt('array entries', () => { return [found70].entries().next().value[1](); });
function found71() { return 'ok 71'; }
attempt('array pattern', () => { const [f] = [found71]; return f(); });
function found72() { return 'ok 72'; }
attempt('array pattern of a set', () => { const [f] = new Set([found72]); return f(); });
function found73() { return 'ok 73'; }
attempt('array forEach', () => { let r; [found73].forEach(f => { r = f(); }); return r; });
function found74() { return 'ok 74'; }
attempt('array sort comparator', () => { let r; [2, 1].sort((a, b) => { r = found74(); return a - b; }); return r; });
function found75() { return 'ok 75'; }
attempt('comparator itself', () => { return typeof [2, 1].sort(found75); });
function found76() { return 'ok 76'; }
attempt('groupBy', () => { return Object.groupBy([found76], () => 'k').k[0](); });
function found77() { return 'ok 77'; }
attempt('Map.groupBy', () => { return Map.groupBy([found77], () => 'k').get('k')[0](); });
function found78() { return 'ok 78'; }
attempt('map get', () => { return new Map([['f', found78]]).get('f')(); });
function found79() { return 'ok 79'; }
attempt('map set', () => { return new Map().set('f', found79).get('f')(); });
function found80() { return 'ok 80'; }
attempt('map values', () => { return [...new Map([[1, found80]]).values()][0](); });
function found81() { return 'ok 81'; }
attempt('map keys', () => { return [...new Map([[found81, 1]]).keys()][0](); });
function found82() { return 'ok 82'; }
attempt('map forEach', () => { let r; new Map([[1, found82]]).forEach(f => { r = f(); }); return r; });
function found83() { return 'ok 83'; }
attempt('set forEach', () => { let r; new Set([found83]).forEach(f => { r = f(); }); return r; });
function found84() { return 'ok 84'; }
attempt('set union', () => { return [...new Set().union(new Set([found84]))][0](); });
function found85() { return 'ok 85'; }
attempt('weak map', () => { const k = {}; return new WeakMap([[k, found85]]).get(k)(); });
function found86() { return 'ok 86'; }
attempt('weak ref', () => { return new WeakRef(found86).deref()(); });
function found87() { return 'ok 87'; }
attempt('iterator helpers', () => { return [found87].values().map(x => x).toArray()[0](); });
function found88() { return 'ok 88'; }
attempt('Iterator.from', () => { return Iterator.from([found88]).next().value(); });
function found89() { return 'ok 89'; }
attempt('generator', () => { function* g() { yield found89; } return g().next().value(); });
function found90() { return 'ok 90'; }
attempt('generator return', () => { function* g() { return found90; } return g().next().value(); });
function found91() { return 'ok 91'; }
attempt('generator sent', () => { function* g() { const f = yield; r = f(); } let r; const i = g(); i.next(); i.next(found91); return r; });
function found92() { return 'ok 92'; }
attempt('yield star', () => { function* g() { yield* [found92]; } return [...g()][0](); });
function found93() { return 'ok 93'; }
attempt('arguments', () => { return (function () { return arguments[0](); })(found93); });
function found94() { return 'ok 94'; }
attempt('arguments spread', () => { return (function () { return [...arguments][0](); })(found94); });
function found95() { return 'ok 95'; }
attempt('rest', () => { return ((...a) => a[0]())(found95); });
function found96() { return 'ok 96'; }
attempt('spread call', () => { return (f => f())(...[found96]); });
function found97() { return 'ok 97'; }
attempt('default parameter', () => { return ((f = found97) => f())(); });
function found98() { return 'ok 98'; }
attempt('tagged template', () => { return found98``; });
function found99() { return 'ok 99'; }
attempt('template value', () => { return ((s, f) => f())`${found99}`; });
function found100() { return 'ok 100'; }
attempt('constructor answers it', () => { return new (class { constructor() { return found100; } })()(); });
function found101() { return 'ok 101'; }
attempt('global by a computed name', () => { globalThis.foundByName = found101; return globalThis['found' + 'ByName'](); });
function found102() { return 'ok 102'; }
attempt('global by name', () => { globalThis.foundGlobal = found102; return foundGlobal(); });
function found103() { return 'ok 103'; }
attempt('symbol key', () => { const s = Symbol(); return ({ [s]: found103 })[s](); });
function found104() { return 'ok 104'; }
attempt('registered symbol', () => { return ({ [Symbol.for('found')]: found104 })[Symbol.for('found')](); });
function found105() { return 'ok 105'; }
attempt('toPrimitive', () => { return `${{ [Symbol.toPrimitive]: found105 }}`; });
function found106() { return 'ok 106'; }
attempt('toString', () => { return `${{ toString: found106 }}`; });
function found107() { return 'ok 107'; }
attempt('valueOf', () => { return '' + { valueOf: found107 }; });
function found108() { return 'ok 108'; }
attempt('toJSON', () => { return JSON.stringify({ toJSON: found108 }); });
function found109() { return 'ok 109'; }
attempt('reviver', () => { return typeof JSON.parse('1', found109); });
function found110() { return 'ok 110'; }
attempt('replacer', () => { return typeof JSON.stringify(1, found110); });
function found111() { return 'ok 111'; }
attempt('replace callback', () => { return 'a'.replace('a', found111); });
function found112() { return 'ok 112'; }
attempt('replaceAll callback', () => { return 'a'.replaceAll(/a/g, found112); });
function found113() { return 'ok 113'; }
attempt('hasInstance', () => { return typeof (1 instanceof { [Symbol.hasInstance]: found113 }); });
function found114() { return 'ok 114'; }
attempt('iterator method', () => { try { return typeof [...{ [Symbol.iterator]: found114 }]; } catch (e) { return e.name; } });
function found115() { return 'ok 115'; }
attempt('species', () => { class A extends Array { static get [Symbol.species]() { found115(); return Array; } } return typeof new A().map(x => x); });
function found116() { return 'ok 116'; }
attempt('proxy get trap', () => { return new Proxy({}, { get: () => found116 }).f(); });
function found117() { return 'ok 117'; }
attempt('proxy target', () => { return new Proxy({ f: found117 }, {}).f(); });
function found118() { return 'ok 118'; }
attempt('proxy of the function', () => { return new Proxy(found118, {})(); });
function found119() { return 'ok 119'; }
attempt('proxy apply trap', () => { return new Proxy(function () {}, { apply: found119 })(); });
function found120() { return 'ok 120'; }
attempt('then', () => { return typeof Promise.resolve({ then: found120 }); });
function found121() { return 'ok 121'; }
attempt('class field', () => { return new (class { f = found121; })().f(); });
function found122() { return 'ok 122'; }
attempt('private field', () => { return new (class { #f = found122; g() { return this.#f(); } })().g(); });
function found123() { return 'ok 123'; }
attempt('static block', () => { class A { static { this.f = found123; } } return A.f(); });
function found124() { return 'ok 124'; }
attempt('static private', () => { class A { static #f = found124; static g() { return A.#f(); } } return A.g(); });
function found125() { return 'ok 125'; }
attempt('accessor of a class', () => { class A { get f() { return found125; } } return new A().f(); });
function found126() { return 'ok 126'; }
attempt('super property', () => { class A { f() { return found126(); } } class B extends A { g() { return super.f(); } } return new B().g(); });
function found127() { return 'ok 127'; }
attempt('method borrowed', () => { const o = { m() { return found127(); } }; const m = o.m; return m(); });
function found128() { return 'ok 128'; }
attempt('heritage', () => { return typeof new (class extends found128 {})(); });
function found129() { return 'ok 129'; }
attempt('comma', () => { return (0, found129)(); });
function found130() { return 'ok 130'; }
attempt('conditional', () => { return (Math.random() < 2 ? found130 : null)(); });
function found131() { return 'ok 131'; }
attempt('logical', () => { return (null ?? found131)(); });
function found132() { return 'ok 132'; }
attempt('optional call', () => { return found132?.(); });
function found133() { return 'ok 133'; }
attempt('optional member', () => { return ({ f: found133 })?.f?.(); });
function found134() { return 'ok 134'; }
attempt('closure variable', () => { let f; (() => { f = found134; })(); return f(); });
function found135() { return 'ok 135'; }
attempt('thrown', () => { try { throw found135; } catch (f) { return f(); } });
function found136() { return 'ok 136'; }
attempt('structured in an error', () => { try { throw Object.assign(new Error('x'), { f: found136 }); } catch (e) { return e.f(); } });
function found137() { return 'ok 137'; }
attempt('error cause', () => { return new Error('x', { cause: found137 }).cause(); });
function found138() { return 'ok 138'; }
attempt('queueMicrotask', () => { queueMicrotask(found138); return 'later'; });
function found139() { return 'ok 139'; }
attempt('setTimeout', () => { setTimeout(found139, 0); return 'later'; });
function found140() { return 'ok 140'; }
attempt('nextTick', () => { process.nextTick(found140); return 'later'; });
function found141() { return 'ok 141'; }
attempt('finally', () => { Promise.resolve().finally(found141); return 'later'; });
function found142() { return 'ok 142'; }
attempt('event target', () => { const t = new EventTarget(); let r; t.addEventListener('x', () => { r = found142(); }); t.dispatchEvent(new Event('x')); return r; });
function found143() { return 'ok 143'; }
attempt('listener itself', () => { const t = new EventTarget(); t.addEventListener('x', found143); return t.dispatchEvent(new Event('x')); });
function found144() { return 'ok 144'; }
attempt('handleEvent', () => { const t = new EventTarget(); t.addEventListener('x', { handleEvent: found144 }); return t.dispatchEvent(new Event('x')); });
function found145() { return 'ok 145'; }
attempt('abort listener', () => { const c = new AbortController(); c.signal.onabort = found145; c.abort(); return 'done'; });
function found146() { return 'ok 146'; }
attempt('finalization registry', () => { return typeof new FinalizationRegistry(found146); });
function found147() { return 'ok 147'; }
attempt('inspect custom', () => { return typeof Bun.inspect({ [Symbol.for('nodejs.util.inspect.custom')]: found147 }); });
await new Promise(resolve => setTimeout(resolve, 20));
for (const line of results) console.log(line);
