// a binary heap with updates by key
class Heap {
  constructor(less) { this.items = []; this.at = new Map(); this.less = less || ((a, b) => a.priority < b.priority); this.moves = 0; }
  get size() { return this.items.length; }
  push(key, priority, value) {
    if (this.at.has(key)) { const i = this.at.get(key), old = this.items[i]; this.items[i] = { key, priority, value }; if (this.less(this.items[i], old)) this._up(i); else this._down(i); return false; }
    this.items.push({ key, priority, value }); this.at.set(key, this.items.length - 1); this._up(this.items.length - 1); return true;
  }
  pop() { if (!this.items.length) return undefined; const top = this.items[0], last = this.items.pop(); this.at.delete(top.key); if (this.items.length) { this.items[0] = last; this.at.set(last.key, 0); this._down(0); } return top; }
  remove(key) { const i = this.at.get(key); if (i === undefined) return false; const last = this.items.pop(); this.at.delete(key); if (i < this.items.length) { this.items[i] = last; this.at.set(last.key, i); this._up(i); this._down(this.at.get(last.key)); } return true; }
  _swap(i, j) { const a = this.items[i], b = this.items[j]; this.items[i] = b; this.items[j] = a; this.at.set(b.key, i); this.at.set(a.key, j); this.moves++; }
  _up(i) { while (i > 0) { const p = (i - 1) >> 1; if (!this.less(this.items[i], this.items[p])) break; this._swap(i, p); i = p; } }
  _down(i) { const n = this.items.length; for (;;) { let m = i, l = 2 * i + 1, r = l + 1; if (l < n && this.less(this.items[l], this.items[m])) m = l; if (r < n && this.less(this.items[r], this.items[m])) m = r; if (m === i) return; this._swap(i, m); i = m; } }
  check() { for (let i = 1; i < this.items.length; i++) if (this.less(this.items[i], this.items[(i - 1) >> 1])) return false; return [...this.at].every(([k, i]) => this.items[i].key === k); }
}
module.exports = Heap;
