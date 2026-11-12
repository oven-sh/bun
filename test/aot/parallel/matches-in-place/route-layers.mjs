function decode(val) { return typeof val !== "string" || val.length === 0 ? val : decodeURIComponent(val); }
class Layer {
  constructor(path, regexp, keys) { this.keys = keys; this.params = undefined; this.regexp = regexp; this.regexp.fast_star = path === "*"; this.regexp.fast_slash = path === "/"; }
  match(path) {
    let match;
    if (path != null) { if (this.regexp.fast_slash) { this.params = {}; return true; } if (this.regexp.fast_star) { this.params = { 0: decode(path) }; return true; } match = this.regexp.exec(path); }
    if (!match) { this.params = undefined; return false; }
    this.params = {};
    for (let i = 1; i < match.length; i++) { const prop = this.keys[i - 1], val = decode(match[i]); if (val !== undefined || !Object.hasOwn(this.params, prop)) this.params[prop] = val; }
    return true;
  }
}
const layers = [new Layer("/", /^\/?$/i, []), new Layer("/user/:id/:tab?", /^\/user\/([^/]+?)(?:\/([^/]+?))?\/?$/i, ["id", "tab"]), new Layer("*", /^(.*)\/?$/i, [])];
for (const path of ["/user/7/posts", "/user/8", "/user/9/a%20b", "/", "/other", "/user/10"]) { for (const layer of layers) if (layer.match(path)) { console.log(path, JSON.stringify(layer.params)); break; } }
