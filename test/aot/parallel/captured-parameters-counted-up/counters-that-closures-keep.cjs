var out = [];
function flatten(tokens, index, result, callback) { while (index < tokens.length) { const token = tokens[index++]; if (Array.isArray(token)) { for (const part of token) flatten([part], 0, result.slice(), seq => flatten(tokens, index, seq, callback)); return; } result.push(token); } callback(result); }
flatten(JSON.parse('["a",["b","c"],"d",["e"]]'), 0, [], r => out.push(r.join('')));
function mergeInner(source, project, active, index) { var done = []; source.forEach(function (v) { active++; project(v, index++, function (x) { active--; done.push(x + ':' + active + ':' + index); }); }); return done; }
out.push(mergeInner([1, 2, 3], (v, i, cb) => cb(v * i), 0, 0).join()); out.push(mergeInner([1, 2], (v, i, cb) => cb(v * i), 0.5, -0).join());
function eachOf(list, n, f) { var keep = function () { return n; }; for (; n < list.length; n++) f(list[n], n, keep); return keep; } out.push(eachOf(['a', 'b'], 0, (v, i, k) => out.push(v + i + k()))());
function bornLater(list) { var n; var get = () => n; list.forEach(v => { n = n === undefined ? v : n + v; }); return get; } out.push(bornLater([1, 2, 3])(), bornLater([])(), bornLater([0.5])());
function sloppyArguments(a, b) { arguments[0]++; const f = () => a + b; b *= 2; arguments[1] = arguments[1] + 1; return f(); } out.push(sloppyArguments(1, 2), sloppyArguments(1.5, 2), sloppyArguments('x', 1));
function defaults(n = 3, step = n * 2, get = () => n + step) { n++; step -= 1; return [get(), n, step].join(); } out.push(defaults(), defaults(1), defaults(undefined, 0.25));
function swapped(a, b) { [a, b] = [b, a]; return () => [a++, b--].join(); } var s = swapped(1, 2); out.push(s(), s());
function overflow(n) { const up = () => { n += 1; return n; }; up(); up(); return n; } out.push(overflow(2147483646), overflow(Number.MAX_SAFE_INTEGER), overflow(-1.5), Object.is(overflow(-2), 0));
function shared(i) { const a = () => i++, b = () => i--, c = v => (i = v); a(); a(); b(); c(i * 3); return i; } out.push(shared(2), shared(NaN), shared(null), shared('7'), shared(true));
function nested(i) { return function () { i++; return function () { i *= 2; return () => i; }; }; } out.push(nested(1)()()(), nested('a')()()());
function caught(n) { try { throw { n }; } catch ({ n: m }) { const f = () => m; m++; n += f(); return () => n; } } out.push(caught(4)());
function labeled(rows, hit) { outer: for (let i = 0, up = () => i++; i < rows.length; i++) { for (let j = 0; j < rows[i].length; j++) { if (rows[i][j] === 0) { up(); hit++; continue outer; } if (rows[i][j] < 0) break outer; } } return () => hit; } out.push(labeled([[1, 0], [0], [2], [0]], 0)(), labeled([[1], [-1], [0]], 5)());
function* steps(n, by) { const jump = k => { n += k; }; while (n > 0) { const got = yield n; if (got) jump(got); n -= by; } } var g = steps(5, 2), seen = []; for (var r = g.next(); !r.done; r = g.next(seen.length === 1 ? 3 : 0)) seen.push(r.value); out.push(seen.join());
function finals(n) { const f = () => n; try { n++; return [f(), n]; } finally { n *= 10; out.push(f()); } } out.push(finals(1).join());
function evalless(n, list) { for (var i = 0; i < 3; i++) list.push(() => n + i); n = -n; return list; } out.push(evalless(1, []).map(f => f()).join()); function closures(n, list) { for (let i = 0; i < 3; i++) { list.push(() => n++ + i); } return list; } out.push(closures(1, []).map(f => f()).join());
(async function (n) { const add = async k => { n += await k; return n; }; const a = add(1), b = add(2); await null; n *= 10; out.push((await Promise.all([a, b])).join(), n); })(5).then(() => console.log(out.join(' | ')));
