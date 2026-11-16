// options laid over defaults: copies made in place, getters, symbols, missing and null, order of keys, sealed ones, plugins that add their own
'use strict';
var defaults = { host: 'localhost', port: 80, retry: { n: 3, wait: 100 }, tags: ['a'], debug: false, onEvent: null };
var S = Symbol('inner');
function options(user) { return Object.assign({}, defaults, user); }
function Client(user, extra) { this.options = Object.assign(Object.create(Client.defaults), user); this.settings = Object.assign({ made: ++Client.n, kind: this.constructor.name }, extra, { last: true }); this.id = Client.n; }
Client.n = 0;
Client.defaults = { timeout: 10, get url() { return (this.secure ? 'https' : 'http') + '://' + (this.host || defaults.host) + ':' + (this.port || defaults.port); }, secure: false };
Client.prototype.with = function (more) { var c = new this.constructor(Object.assign({}, this.options, more), { from: this.id }); return c; };
Client.prototype.json = function () { var o = {}; for (var k in this.options) o[k] = this.options[k]; return JSON.stringify(o); };
function Deep(user) { var self = this; Object.keys(defaults).forEach(function (k) { var d = defaults[k], u = user && user[k]; self[k] = u === undefined ? Array.isArray(d) ? d.slice() : d && typeof d === 'object' ? { ...d } : d : d && typeof d === 'object' && !Array.isArray(d) && u ? { ...d, ...u } : u; }); }
function pick(o, keys) { return keys.reduce(function (a, k) { return k in o ? Object.assign(a, { [k]: o[k] }) : a; }, {}); }
function omit(o) { var out = { ...o }; for (var i = 1; i < arguments.length; i++) delete out[arguments[i]]; return out; }
function order(o) { return Reflect.ownKeys(o).map(String).join(); }
module.exports = { options: options, Client: Client, Deep: Deep, pick: pick, omit: omit, order: order, defaults: defaults, S: S };
