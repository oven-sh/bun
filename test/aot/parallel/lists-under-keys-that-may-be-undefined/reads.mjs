// A list or a view read under what shift, pop, Map.get, another list or a view gives: a number or undefined; also under null, a boolean, NaN, -1, 1.5. What the program laid on the list itself under such a name is found.
class Arc { constructor(to, cap) { this.to = to; this.cap = cap; } left() { return this.cap - this.to; } }
const adj = [[new Arc(1, 5)], [new Arc(2, 7)], []], q = [0]; let s = 0; while (q.length) { const v = q.shift(); for (const a of adj[v]) { s += a.left(); q.push(a.to); } } console.log(s, adj[q.shift()], adj[q.pop()]);
const l = [10, 20]; l["undefined"] = "own"; l.null = "n"; const k = [1, undefined, null, true, NaN, -1, 1.5, "0"]; console.log(k.map(x => String(l[x])).join(), Object.keys(l).join());
const ids = new Map([["a", 1]]), nodes = [new Arc(3, 9), new Arc(4, 9)]; console.log(nodes[ids.get("a")].left(), nodes[ids.get("b")]); let e = ""; try { nodes[ids.get("b")].left(); } catch (x) { e = x.name; } console.log(e);
const v = new Uint8Array([1, 2, 0]), w = [5, 6, 7]; let t = 0; for (let i = 0; i < 4; i++) t += w[v[i]] ?? 100; console.log(t, v[undefined], (v.undefined = 3, v[undefined]), w[w[0]]);
const o = {}; console.log([7][o.at], [7][o.at ?? 0], [[1, 2]][0][[].pop()], [..."ab"][[1].indexOf(9) < 0 ? undefined : 0]);
