// An async function returns a copy of what Object.fromEntries made of a list that map made.
// Under: --aot-check=FlowFixpoint: what is awaited was not told of all that the copy holds, and the flow was not closed.
async function f(l) { return { ...Object.fromEntries(Object.keys(l).map(k => [k, l[k]])) }; }
async function g(l) { const p = Object.fromEntries(Object.keys(l).filter(k => k).map(k => [k, 1])); await 1; return { ...p, key: l.a }; }
function h(l) { const { a, ...rest } = Object.fromEntries(Object.keys(l).map(k => [k, l[k]])); return rest; }
console.log(JSON.stringify(await f(JSON.parse('{"a":1}'))), JSON.stringify(await Promise.all(JSON.parse('[{"a":1},{"b":[2]}]').map(g))), JSON.stringify(await h(JSON.parse('{"a":1,"b":null}'))));
