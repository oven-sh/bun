"use strict";
// Lists, lists in fields and typed arrays are stored into under a number, undefined, null, a boolean and a number that is no index, and read by index, by name, by their own keys and by their methods.
const at = new Map([["a", 0], ["b", 2], ["n", null], ["t", true], ["m", -1], ["h", 1.5]]), out = [];
const put = (list, name, x) => { list[at.get(name)] = x; }, mix = (list, name, x) => { list[at.get(name)] |= x; };
class Box { constructor() { this.rows = []; for (let i = 0; i < 4; i++) this.rows[i] = 0; } or(name, x) { this.rows[at.get(name)] |= x; } sum() { let s = 0; for (let i = 0; i < this.rows.length; i++) s += this.rows[i]; return s; } }
const show = v => { let s = v.length + ":"; for (const k in v) s += k + "=" + v[k] + ";"; return s + v.undefined + v.null + v.true + Object.keys(v).length; };
const plain = [0, 0, 0], view = new Int32Array(3), box = new Box();
for (const list of [plain, view]) { put(list, "a", 5); out.push(show(list)); put(list, "zz", 7); mix(list, "b", 6); mix(list, "yy", 8); put(list, "n", 1); put(list, "t", 2); put(list, "m", 3); put(list, "h", 4); out.push(show(list), list.map(x => x + 1).join(), list.slice().undefined, JSON.stringify(list), Object.keys({ ...list }).join()); }
box.or("a", 3); box.or("b", 4); out.push(box.sum(), show(box.rows)); box.or("zz", 9); out.push(box.sum(), show(box.rows), box.rows.indexOf(9), box.rows.concat([1]).length);
put(plain, "qq", () => 11); out.push(plain.undefined(), plain.length); put(plain, "qq", "text"); out.push(plain.undefined, plain.pop(), plain.length);
console.log(out.join("|"));
