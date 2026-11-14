// routes written as expressions; the groups are read by index where they are matched, upward and downward, by name lists and by position
var routes = [];
function add(re, keys, name, how) { re.keys = keys; routes.push({ re: re, name: name, how: how || 'up', hits: 0 }); return routes.length; }
add(/^\/a(?:\/(\w+))?(?:\/(\w+))?$/, ['x', 'y'], 'a');
add(/^\/b\/(\d+)(\.json)?$/, ['n', 'ext'], 'b');
add(/^\/user\/([^/]+?)(?:\/([^/]+?))?\/?$/i, ['id', 'tab'], 'user', 'down');
add(/^\/(\d{4})\/(\d\d)\/(\d\d)\/([\w-]+)$/, ['y', 'm', 'd', 'slug'], 'post');
add(/^\/search(?:\/(page)\/(\d+))?(?:\/(asc|desc))?$/, ['p', 'n', 'order'], 'search', 'both');
add(/^\/static\/(.*)$/, ['rest'], 'static');
function decode(v) { return typeof v !== 'string' || v.length === 0 ? v : decodeURIComponent(v); }
function route(url) {
  var q = url.indexOf('?'), path = q < 0 ? url : url.substring(0, q);
  for (var r of routes) {
    var m = r.re.exec(path);
    if (!m) continue;
    r.hits++;
    var out = {};
    if (r.how !== 'down') for (var i = 1; i < m.length; i++) { if (m[i] !== undefined) out[r.re.keys[i - 1]] = decode(m[i]); }
    if (r.how !== 'up') for (var k = m.length; k-- > 1;) { var v = m[k]; out['-' + r.re.keys[k - 1]] = v === undefined ? null : v; }
    return { name: r.name, params: out, path: m[0], query: q < 0 ? '' : url.slice(q + 1), groups: m.length - 1 };
  }
  return null;
}
function Old(list) { this.list = list; this.last = null; }
Old.prototype.find = function (path) {
  for (var i = 0; i < this.list.length; i++) {
    var layer = this.list[i], found = layer[0].exec(path);
    if (found !== null) {
      var args = [];
      for (var j = 1, n = found.length; j < n; j++) args.push(found[j] || layer[2]);
      this.last = found;
      return layer[1].apply(this, args.concat(path.length));
    }
  }
  return 'none ' + (this.last ? this.last[this.last.length - 1] : '');
};
module.exports = { add: add, route: route, routes: routes, Old: Old };
