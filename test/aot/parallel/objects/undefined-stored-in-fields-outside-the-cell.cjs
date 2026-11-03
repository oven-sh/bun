// Objects with more fields than their cell holds. A field kept outside the cell may exist without storage while it holds undefined, and then only the key order says that it exists.
const out = [];
function show(label, o) { const d = Object.getOwnPropertyDescriptors(o); out.push(label + ' ' + Reflect.ownKeys(o).map(k => { const p = d[k]; return String(k) + ('value' in p ? '=' + String(p.value) : ':accessor') + (p.writable === false ? ':ro' : '') + (p.enumerable ? '' : ':hidden'); }).join(' ')); }
const bag = {};
function voidAll(e) { e.n89 = e.n88 = e.n87 = e.n86 = e.n85 = e.n84 = e.n83 = e.n82 = e.n81 = e.n80 = e.n79 = e.n78 = e.n77 = e.n76 = e.n75 = e.n74 = e.n73 = e.n72 = e.n71 = e.n70 = e.n69 = e.n68 = e.n67 = e.n66 = e.n65 = e.n64 = e.n63 = e.n62 = e.n61 = e.n60 = e.n59 = e.n58 = e.n57 = e.n56 = e.n55 = e.n54 = e.n53 = e.n52 = e.n51 = e.n50 = e.n49 = e.n48 = e.n47 = e.n46 = e.n45 = e.n44 = e.n43 = e.n42 = e.n41 = e.n40 = e.n39 = e.n38 = e.n37 = e.n36 = e.n35 = e.n34 = e.n33 = e.n32 = e.n31 = e.n30 = e.n29 = e.n28 = e.n27 = e.n26 = e.n25 = e.n24 = e.n23 = e.n22 = e.n21 = e.n20 = e.n19 = e.n18 = e.n17 = e.n16 = e.n15 = e.n14 = e.n13 = e.n12 = e.n11 = e.n10 = e.n9 = e.n8 = e.n7 = e.n6 = e.n5 = e.n4 = e.n3 = e.n2 = e.n1 = e.n0 = void 0; return e; }
show('void chain', voidAll(bag));
for (const k of ['n3', 'n40', 'n77', 'n89']) Object.defineProperty(bag, k, { enumerable: true, get() { return 'got ' + k; } });
show('getters over it', bag); out.push(bag.n40 + ' ' + bag.n41 + ' ' + ('n41' in bag) + ' ' + Object.hasOwn(bag, 'n88') + ' ' + ('n90' in bag));
show('void chain again', voidAllQuietly(bag));
function voidAllQuietly(e) { for (const k of ['n0', 'n7', 'n14', 'n21', 'n28', 'n35', 'n42', 'n49', 'n56', 'n63', 'n70', 'n77', 'n84']) { try { e[k] = undefined; } catch (x) { out.push(k + ' ' + x.constructor.name); } } e.n1 = void 0; e.n50 = void 0; e.n88 = undefined; return e; }
function cycle(o) { o.n60 = undefined; o.n61 = undefined; o.n60 = 1; o.n62 = 'x'; o.n61 = undefined; delete o.n60; o.n60 = undefined; o.n63 = undefined; delete o.n63; o.n64 = undefined; o.n63 = undefined; return o; }
function wide() { return { n0: 0, n1: 1, n2: 2, n3: 3, n4: 4, n5: 5, n6: 6, n7: 7, n8: 8, n9: 9, n10: 10, n11: 11, n12: 12, n13: 13, n14: 14, n15: 15, n16: 16, n17: 17, n18: 18, n19: 19, n20: 20, n21: 21, n22: 22, n23: 23, n24: 24, n25: 25, n26: 26, n27: 27, n28: 28, n29: 29, n30: 30, n31: 31, n32: 32, n33: 33, n34: 34, n35: 35, n36: 36, n37: 37, n38: 38, n39: 39 }; }
show('cycle', cycle(wide())); show('cycle', cycle(wide()));
out.push(JSON.stringify(cycle(wide())).length + ' ' + Object.keys(cycle(wide())).slice(-6).join());
class Wide { n0 = 0; n1 = undefined; n2 = undefined; n3; n4 = undefined; n5 = 5; n6; n7 = undefined; n8 = undefined; n9; n10 = 10; n11 = undefined; n12; n13 = undefined; n14 = undefined; n15 = 15; n16 = undefined; n17 = undefined; n18; n19 = undefined; n20 = 20; n21; n22 = undefined; n23 = undefined; n24; n25 = 25; n26 = undefined; n27; n28 = undefined; n29 = undefined; n30 = 30; n31 = undefined; n32 = undefined; n33; n34 = undefined; n35 = 35; n36; n37 = undefined; n38 = undefined; n39; n40 = 40; n41 = undefined; n42; n43 = undefined; n44 = undefined; n45 = 45; n46 = undefined; n47 = undefined; n48; n49 = undefined; n50 = 50; n51; n52 = undefined; n53 = undefined; n54; n55 = 55; n56 = undefined; n57; n58 = undefined; n59 = undefined; n60 = 60; n61 = undefined; n62 = undefined; n63; n64 = undefined; n65 = 65; n66; n67 = undefined; n68 = undefined; n69; constructor(late) { this.n5 = undefined; this.n69 = late; this.extra = undefined; } }
class Wider extends Wide { tail = undefined; n7 = undefined; constructor(late) { super(late); this.tail = undefined; this.n68 = undefined; } }
show('class', new Wide(undefined)); show('class', new Wide(4)); show('subclass', new Wider(undefined));
function late(o) { 'use strict'; o.n70 = undefined; return o; }
function wideWithLate(v) { const o = wide(); if (v) { o.n70 = v; delete o.n70; } return o; }
for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) { try { show('locked', late(lock(wideWithLate(0)))); } catch (e) { out.push('locked ' + e.constructor.name + ': ' + e.message); } }
const log = []; const above = { set n70(v) { log.push('setter ' + v); } };
const below = Object.setPrototypeOf(wideWithLate(0), above); late(below); out.push(Object.hasOwn(below, 'n70') + ' ' + log.join());
show('late', late(wideWithLate(1))); show('late twice', late(late(wideWithLate(0))));
console.log(out.join('\n'));
