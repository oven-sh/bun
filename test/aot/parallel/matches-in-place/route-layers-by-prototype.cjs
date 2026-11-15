var routes = [];
function add(re, keys, name) { re.keys = keys; routes.push({ re: re, name: name }); }
add(/^\/a(?:\/(\w+))?(?:\/(\w+))?$/, ["x", "y"], "a"); add(/^\/b\/(\d+)(\.json)?$/, ["n", "ext"], "b");
function route(path) { for (var r of routes) { var m = r.re.exec(path); if (!m) continue; var out = {}; for (var i = 1; i < m.length; i++) if (m[i] !== undefined) out[r.re.keys[i - 1]] = m[i]; return r.name + JSON.stringify(out); } return "none"; }
console.log(["/a/one/two", "/a/one", "/a", "/b/12.json", "/b/3", "/c", "/a/x"].map(route).join(" "));
