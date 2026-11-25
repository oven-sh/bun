// o.hasOwnProperty read in a loop and called without its object, or on another one.
function bare(o, keys) { let n = 0; for (const k of keys) { try { const has = o.hasOwnProperty; if (has(k)) n++; } catch (error) { n += 10; } } return n; }
function comma(o, keys) { let n = 0; for (let i = 0; i < keys.length; i++) { try { if ((0, o.hasOwnProperty)(keys[i])) n++; } catch (error) { n += error instanceof TypeError ? 10 : 100; } } return n; }
function other(o, p, keys) { let n = 0; for (const k of keys) { const has = o.hasOwnProperty; if (has.call(p, k)) n++; if (o.hasOwnProperty.call(o, k)) n += 100; if (has.apply(p, [k])) n += 10000; } return n; }
function optional(o, keys) { let n = 0; for (const k of keys) { if (o?.hasOwnProperty(k)) n++; if (o.hasOwnProperty?.(k)) n += 100; if ((o.hasOwnProperty)(k)) n += 10000; } return n; }
function parts(o, keys) { let n = 0; for (const k of keys) { const { hasOwnProperty } = o; try { if (hasOwnProperty(k)) n++; } catch (error) { n += 7; } } return n; }
function tagged(o, keys) { let n = 0; for (const k of keys) { try { if (o.hasOwnProperty`${k}`) n++; } catch (error) { n += 3; } } return n; }
function spliced(list, n) { const out = []; for (let i = 0; i < n; i++) { try { const cut = list.splice; out.push(cut(0, 1, i, i)); } catch (error) { out.push(error.name); } } return out.join(); }
const keys = ["a", "b", "toString", "c"], objects = [{ a: 1 }, { b: 2, c: 3 }, Object.create({ a: 1 }), [1, 2], { hasOwnProperty(k) { return k > "b"; } }, class A { static a = 1; }];
for (let round = 0; round < 3; round++) for (const o of objects) console.log(bare(o, keys), comma(o, keys), other(o, objects[0], keys), optional(o, keys), parts(o, keys), tagged(o, keys));
console.log(optional(objects[0], []), spliced([1, 2, 3], 4));
