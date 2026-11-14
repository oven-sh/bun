// Properties of functions that loops store into at their addresses, while the iterations make other properties of the function, which move its storage, or change the property itself.
// STATISTIC: KeyedAddressesHoisted >= 5
let g: any = null;
const h: any = JSON.parse("{}");
const list: any[] = [1];
const K: number = JSON.parse("5");
function F0(a?: any): any { return a; }
(F0 as any).p0 = 0;
(F0 as any).p1 = 1;
(F0 as any).v = 1;
(F0 as any).w = 2;
h.f0 = F0;
function run0(k: any): any { let n: any = 0; let i = k; do { (F0 as any).v = i; g = new (F0 as any)();  i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run0(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f0, "v"); console.log("constructs", String(said), String(d.value), (F0 as any).v, (F0 as any).w, (F0 as any).p1, Object.keys(h.f0).length); }
function F1(a?: any): any { return a; }
(F1 as any).p0 = 0;
(F1 as any).p1 = 1;
(F1 as any).p2 = 2;
(F1 as any).v = 1;
(F1 as any).w = 2;
h.f1 = F1;
function run1(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F1 as any).v++; g = (F1 as any).prototype; n += (F1 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run1(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f1, "v"); console.log("prototype", String(said), String(d.value), (F1 as any).v, (F1 as any).w, (F1 as any).p1, Object.keys(h.f1).length); }
function F2(a?: any): any { return a; }
(F2 as any).p0 = 0;
(F2 as any).p1 = 1;
(F2 as any).p2 = 2;
(F2 as any).p3 = 3;
(F2 as any).v = 1;
(F2 as any).w = 2;
h.f2 = F2;
function run2(k: any): any { let n: any = 0; let i = k; do {  g = (F2 as any).name; (F2 as any).v = i; i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run2(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f2, "v"); console.log("name", String(said), String(d.value), (F2 as any).v, (F2 as any).w, (F2 as any).p1, Object.keys(h.f2).length); }
function F3(a?: any): any { return a; }
(F3 as any).p0 = 0;
(F3 as any).p1 = 1;
(F3 as any).v = 1;
(F3 as any).w = 2;
h.f3 = F3;
function run3(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F3 as any).v += i; g = (F3 as any).length; n += (F3 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run3(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f3, "v"); console.log("length", String(said), String(d.value), (F3 as any).v, (F3 as any).w, (F3 as any).p1, Object.keys(h.f3).length); }
function F4(a?: any): any { return a; }
(F4 as any).p0 = 0;
(F4 as any).p1 = 1;
(F4 as any).p2 = 2;
(F4 as any).v = 1;
(F4 as any).w = 2;
h.f4 = F4;
function run4(k: any): any { let n: any = 0; let i = k; do { (F4 as any).v = i; g = Object.keys((F4 as any)).length;  i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run4(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f4, "v"); console.log("names", String(said), String(d.value), (F4 as any).v, (F4 as any).w, (F4 as any).p1, Object.keys(h.f4).length); }
function F5(a?: any): any { return a; }
(F5 as any).p0 = 0;
(F5 as any).p1 = 1;
(F5 as any).p2 = 2;
(F5 as any).p3 = 3;
(F5 as any).v = 1;
(F5 as any).w = 2;
h.f5 = F5;
function run5(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F5 as any).v++; h.f5.q = i; n += (F5 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run5(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f5, "v"); console.log("other", String(said), String(d.value), (F5 as any).v, (F5 as any).w, (F5 as any).p1, Object.keys(h.f5).length); }
function F6(a?: any): any { return a; }
(F6 as any).p0 = 0;
(F6 as any).p1 = 1;
(F6 as any).v = 1;
(F6 as any).w = 2;
h.f6 = F6;
function run6(k: any): any { let n: any = 0; let i = k; do {  (F6 as any).late = i; (F6 as any).v = i; i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run6(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f6, "v"); console.log("late", String(said), String(d.value), (F6 as any).v, (F6 as any).w, (F6 as any).p1, Object.keys(h.f6).length); }
function F7(a?: any): any { return a; }
(F7 as any).p0 = 0;
(F7 as any).p1 = 1;
(F7 as any).p2 = 2;
(F7 as any).v = 1;
(F7 as any).w = 2;
h.f7 = F7;
function run7(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F7 as any).v += i; g = (F7 as any)(i); n += (F7 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run7(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f7, "v"); console.log("called", String(said), String(d.value), (F7 as any).v, (F7 as any).w, (F7 as any).p1, Object.keys(h.f7).length); }
function F8(a?: any): any { return a; }
(F8 as any).p0 = 0;
(F8 as any).p1 = 1;
(F8 as any).p2 = 2;
(F8 as any).p3 = 3;
(F8 as any).v = 1;
(F8 as any).w = 2;
h.f8 = F8;
function run8(k: any): any { let n: any = 0; let i = k; do { (F8 as any).v = i; g = list[0] instanceof (F8 as any);  i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run8(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f8, "v"); console.log("instance", String(said), String(d.value), (F8 as any).v, (F8 as any).w, (F8 as any).p1, Object.keys(h.f8).length); }
function F9(a?: any): any { return a; }
(F9 as any).p0 = 0;
(F9 as any).p1 = 1;
(F9 as any).v = 1;
(F9 as any).w = 2;
h.f9 = F9;
function run9(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F9 as any).v++;  n += (F9 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run9(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f9, "v"); console.log("counts", String(said), String(d.value), (F9 as any).v, (F9 as any).w, (F9 as any).p1, Object.keys(h.f9).length); }
function F10(a?: any): any { return a; }
(F10 as any).p0 = 0;
(F10 as any).p1 = 1;
(F10 as any).p2 = 2;
(F10 as any).v = 1;
(F10 as any).w = 2;
h.f10 = F10;
function run10(k: any): any { let n: any = 0; let i = k; do {  if (i === 2) delete h.f10.w; (F10 as any).v = i; i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run10(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f10, "v"); console.log("deleted", String(said), String(d.value), (F10 as any).v, (F10 as any).w, (F10 as any).p1, Object.keys(h.f10).length); }
function F11(a?: any): any { return a; }
(F11 as any).p0 = 0;
(F11 as any).p1 = 1;
(F11 as any).p2 = 2;
(F11 as any).p3 = 3;
(F11 as any).v = 1;
(F11 as any).w = 2;
h.f11 = F11;
function run11(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F11 as any).v += i; if (i === 3) h.f11.v = "7"; n += (F11 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run11(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f11, "v"); console.log("text", String(said), String(d.value), (F11 as any).v, (F11 as any).w, (F11 as any).p1, Object.keys(h.f11).length); }
function F12(a?: any): any { return a; }
(F12 as any).p0 = 0;
(F12 as any).p1 = 1;
(F12 as any).v = 1;
(F12 as any).w = 2;
h.f12 = F12;
function run12(k: any): any { let n: any = 0; let i = k; do { (F12 as any).v = i; if (i === 3) Object.defineProperty(h.f12, "v", { configurable: true, get() { return 5; }, set(to) { list.push(to); } });  i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run12(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f12, "v"); console.log("accessor", String(said), String(d.value), (F12 as any).v, (F12 as any).w, (F12 as any).p1, Object.keys(h.f12).length); }
function F13(a?: any): any { return a; }
(F13 as any).p0 = 0;
(F13 as any).p1 = 1;
(F13 as any).p2 = 2;
(F13 as any).v = 1;
(F13 as any).w = 2;
h.f13 = F13;
function run13(k: any): any { let n: any = 0; for (let i = K; i > 0; i--) { (F13 as any).v++; if (i === 3) Object.defineProperty(h.f13, "v", { value: 6, writable: false }); n += (F13 as any).v; } return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run13(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f13, "v"); console.log("read only", String(said), String(d.value), (F13 as any).v, (F13 as any).w, (F13 as any).p1, Object.keys(h.f13).length); }
function F14(a?: any): any { return a; }
(F14 as any).p0 = 0;
(F14 as any).p1 = 1;
(F14 as any).p2 = 2;
(F14 as any).p3 = 3;
(F14 as any).v = 1;
(F14 as any).w = 2;
h.f14 = F14;
function run14(k: any): any { let n: any = 0; let i = k; do {  if (i === 3) Object.freeze(h.f14); (F14 as any).v = i; i--; } while (i > 0); return n; }
for (let turn = 0; turn < 3; turn++) { let said: any; try { said = run14(5); } catch (e: any) { said = e.name; } const d: any = Object.getOwnPropertyDescriptor(h.f14, "v"); console.log("frozen", String(said), String(d.value), (F14 as any).v, (F14 as any).w, (F14 as any).p1, Object.keys(h.f14).length); }
console.log(list.join());
export {};
