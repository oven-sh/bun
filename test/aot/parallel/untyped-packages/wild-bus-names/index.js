// an event bus with name spaces, wild cards, once, removal while emitting, error events and answers
'use strict';
class Listener { constructor(fn, ctx, once, order) { this.fn = fn; this.ctx = ctx; this.once = once; this.order = order; this.calls = 0; } }
class Bus {
  constructor(options = {}) { this.sep = options.sep || '.'; this.max = options.max ?? 10; this.tree = Object.create(null); this.seq = 0; this.warned = []; }
  node(name, make) { let n = this.tree; for (const part of Array.isArray(name) ? name : name.split(this.sep)) { if (!n[part]) { if (!make) return null; n[part] = Object.create(null); } n = n[part]; } return n; }
  on(name, fn, ctx, once = false, front = false) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function, got ' + typeof fn);
    const n = this.node(name, true), list = n[Bus.LIST] || (n[Bus.LIST] = []);
    const l = new Listener(fn, ctx === undefined ? this : ctx, once, front ? -++this.seq : ++this.seq);
    list.push(l);
    if (list.length > this.max && !list.warned) { list.warned = true; this.warned.push(String(name)); }
    this.emit('newListener', name, fn);
    return this;
  }
  once(name, fn, ctx) { return this.on(name, fn, ctx, true); }
  prepend(name, fn, ctx) { return this.on(name, fn, ctx, false, true); }
  off(name, fn) { const n = this.node(name); if (!n || !n[Bus.LIST]) return this; if (fn) { const list = n[Bus.LIST]; for (let i = list.length; i--;) if (list[i].fn === fn) { n[Bus.LIST] = list.slice(0, i).concat(list.slice(i + 1)); break; } if (!n[Bus.LIST].length) delete n[Bus.LIST]; } else delete n[Bus.LIST]; return this; }
  match(parts, i, n, out) { if (!n) return out; if (i === parts.length) { if (n[Bus.LIST]) out.push(...n[Bus.LIST]); if (n['**'] && n['**'][Bus.LIST]) out.push(...n['**'][Bus.LIST]); return out; } const p = parts[i]; if (p === '*') { for (const k in n) if (k !== '**') this.match(parts, i + 1, n[k], out); } else this.match(parts, i + 1, n[p], out); this.match(parts, i + 1, n['*'], out); if (n['**']) for (let k = i; k <= parts.length; k++) this.match(parts, k, n['**'], out); return out; }
  emit(name, ...args) {
    const parts = Array.isArray(name) ? name : name.split(this.sep), seen = new Set(), found = this.match(parts, 0, this.tree, []).filter(l => !seen.has(l) && seen.add(l)).sort((a, b) => a.order - b.order);
    if (!found.length) { if (parts[0] === 'error') throw args[0] instanceof Error ? args[0] : new Error('Unhandled error: ' + args[0]); return false; }
    this.event = name;
    for (const l of found) { if (l.once) this.off(name, l.fn); l.calls++; const r = l.fn.apply(l.ctx, args); if (r === Bus.STOP) break; }
    return true;
  }
  ask(name, ...args) { const out = []; for (const l of this.match(name.split(this.sep), 0, this.tree, [])) out.push(l.fn.call(l.ctx, ...args)); return out; }
  count(name) { return this.match(name.split(this.sep), 0, this.tree, []).length; }
}
Bus.LIST = Symbol('listeners'); Bus.STOP = {};
module.exports = Bus;
