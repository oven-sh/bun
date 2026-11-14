// An untyped package and a program of it (keyed): a tree of elements rendered to text, differences as patches, keyed children, components with state and hooks
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var h = lib.h, host = new lib.Host(); function list(keys, n) { return h('ul', { class: 'c' + n, hidden: n % 2 === 0 }, keys.map(function (k) { return h('li', { key: k, style: { fontSize: n + 'px' } }, k, n % 3 ? ' ' + n : null); }), n % 2 && h('p', null, 'odd <', [1, [2, false, null, true]])); } ['abc', 'cab', 'abcd', 'd', '', 'xyz', 'zyx', 'zayb', 'aabb', 'b'].forEach(function (s, i) { host.render(list(s.split('').filter(Boolean), i)); say(i, host.html()); say(host.log.splice(0).join(' ')); }); host.render(h('div', { title: 'x' }, 'changed')).render(h('div', null, h('b'))).render(h('div', { onclick: function () {} })); say(host.html(), host.log.join(' '), host.ids);
