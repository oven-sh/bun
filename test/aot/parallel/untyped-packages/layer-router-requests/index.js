// routes as layers over a compiled expression; exec's groups become parameters
'use strict';
function compile(path, keys, options) {
  var sensitive = options && options.sensitive, end = !options || options.end !== false;
  var source = path.replace(/\/\*$/, '/(.*)').replace(/\/:(\w+)(\([^)]*\))?(\?)?/g, function (_, name, pattern, optional) {
    keys.push({ name: name, optional: !!optional });
    return (optional ? '(?:/' : '/') + (pattern || '([^/]+?)') + (optional ? ')?' : '');
  });
  if (/\(\.\*\)$/.test(source)) keys.push({ name: String(keys.length), optional: false });
  return new RegExp('^' + source + (end ? '\\/?$' : '(?=\\/|$)'), sensitive ? '' : 'i');
}
function decode(val) {
  if (typeof val !== 'string' || val.length === 0) return val;
  try { return decodeURIComponent(val); } catch (err) { err.message = 'Failed to decode param \'' + val + '\''; err.status = 400; throw err; }
}
function Layer(path, options, fn) {
  if (!(this instanceof Layer)) return new Layer(path, options, fn);
  this.handle = fn; this.name = fn.name || '<anonymous>'; this.params = undefined; this.path = undefined; this.keys = [];
  this.regexp = compile(path, this.keys, options); this.fastSlash = path === '/' && options.end === false;
}
Layer.prototype.match = function match(path) {
  var found;
  if (path != null) {
    if (this.fastSlash) { this.params = {}; this.path = ''; return true; }
    found = this.regexp.exec(path);
  }
  if (!found) { this.params = undefined; this.path = undefined; return false; }
  this.params = {}; this.path = found[0];
  var keys = this.keys, params = this.params;
  for (var i = 1; i < found.length; i++) {
    var key = keys[i - 1], prop = key.name, val = decode(found[i]);
    if (val !== undefined || !Object.prototype.hasOwnProperty.call(params, prop)) params[prop] = val;
  }
  return true;
};
function Router() { this.stack = []; this.calls = 0; }
Router.prototype.use = function (path, fn) { if (typeof path === 'function') { fn = path; path = '/'; } this.stack.push(new Layer(path, { end: false }, fn)); return this; };
['get', 'post', 'put', 'delete', 'all'].forEach(function (method) {
  Router.prototype[method] = function (path) {
    for (var i = 1; i < arguments.length; i++) { var layer = new Layer(path, { end: true }, arguments[i]); layer.method = method; this.stack.push(layer); }
    return this;
  };
});
Router.prototype.handle = function (req, res, done) {
  var idx = 0, stack = this.stack, self = this; self.calls++;
  next();
  function next(err) {
    if (err === 'router') return done(null);
    if (idx >= stack.length) return done(err);
    var layer, match = false;
    while (!match && idx < stack.length) {
      layer = stack[idx++];
      try { match = layer.match(req.url.split('?')[0]); } catch (e) { return done(e); }
      if (match && layer.method && layer.method !== 'all' && layer.method !== req.method.toLowerCase()) match = false;
    }
    if (!match) return done(err);
    req.params = merge(layer.params, req.params); req.matched = layer.path;
    if (err) { if (layer.handle.length !== 4) return next(err); return layer.handle(err, req, res, next); }
    if (layer.handle.length > 3) return next();
    try { layer.handle(req, res, next); } catch (e) { next(e); }
  }
};
function merge(params, parent) { var out = {}, k; for (k in parent) out[k] = parent[k]; for (k in params) if (params[k] !== undefined || !(k in out)) out[k] = params[k]; return out; }
module.exports = { Router: Router, Layer: Layer, compile: compile };
