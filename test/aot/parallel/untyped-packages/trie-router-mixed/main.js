// An untyped package and a program of it (mixed): a radix of segments, wildcards and parameters, with backtracking
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const t = new lib({ caseless: true });
t.add('GET', '/', 'home').add('GET', '/a/:x', 'ax').add('GET', '/a/b', 'ab').add('GET', '/a/:x/c', 'axc').add('GET', '/a/b/d', 'abd').add('ANY', '/files/*', 'files').add('POST', '/a/:x', 'post').add('GET', '/:p/:q/:r', 'pqr');
const paths = ['/', '/a/b', '/A/B', '/a/zz', '/a/b/c', '/a/b/d', '/a/q/d', '/files/x/y/z', '/files/', '/x/y/z', '/x/y', '/a/%41', '/a/b/d/e', '/a/zz?b=1'];
for (let n = 0; n < 4; n++) for (const p of paths) for (const m of n % 2 ? ['GET', 'POST'] : ['GET']) { const h = t.find(m, p); say(n, m, p, h ? h.value + ' ' + JSON.stringify(h.params) : null); }
say(t.size);
