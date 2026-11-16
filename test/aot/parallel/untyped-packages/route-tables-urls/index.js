// tables of written expressions in several forms: rows, objects, arrays in fields, switches of kinds; the match is read where it was made, by loops and by names, kept for later turns and compared
'use strict';
const TABLE = [
  [/^\/item\/(\d+)$/, 'item', ['id']],
  [/^\/item\/(\d+)\/(edit|copy)(?:\/(\w+))?$/, 'change', ['id', 'how', 'field']],
  [/^\/tag\/([^/]+)(?:\/([^/]+))*$/, 'tag', ['first', 'last']],
  [/^\/(?:(en|de|fr)\/)?about(?:\.(html|txt))?$/, 'about', ['lang', 'ext']],
  [/^\/x(?:-(\w))?(?:-(\w))?(?:-(\w))?(?:-(\w))?$/, 'x', ['a', 'b', 'c', 'd']],
  [/^\/(.*)$/, 'rest', ['all']]
];
class Table {
  constructor(rows = TABLE) { this.rows = rows; this.hits = new Array(rows.length).fill(0); this.kept = []; this.previous = null; }
  find(url) {
    const path = url.split('#')[0].slice(0);
    for (let r = 0; r < this.rows.length; r++) {
      const [re, name, keys] = this.rows[r];
      const m = re.exec(path);
      if (m === null) continue;
      this.hits[r]++;
      const params = {};
      let filled = 0;
      for (let i = m.length - 1; i >= 1; i--) { const v = m[i]; if (v === undefined) { if (keys[i - 1] === 'ext') params.ext = 'html'; continue; } params[keys[i - 1]] = /^\d+$/.test(v) ? +v : v; filled += v.length; }
      const same = this.previous !== null && this.previous.length === m.length && this.previous[1] === m[1];
      this.previous = m;
      if (this.kept.length < 5 || r === 4) this.kept.push(m);
      return { name, params, filled, same, whole: m[0].length, at: m.index, input: m.input.length };
    }
    return null;
  }
  first(list) { for (const u of list) for (const row of this.rows) { const m = u.match(row[0]); if (m && m[1]) { let s = ''; for (const g of m) s += (g === undefined ? '_' : g[0]); return s; } } return ''; }
  groups() { return this.kept.map(m => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i] !== undefined) n += m[i].length * (i + 1); return n; }); }
}
function tokens(text) {
  const out = [];
  const kinds = { num: /^\d+(\.\d+)?/, word: /^[a-z_]+(\d)?/i, str: /^"((?:[^"\\]|\\(.))*)"/, gap: /^\s+/, op: /^(=>|[-+*\/=<>!&|]=?)|^([()[\]{},;.])/ };
  let rest = text;
  loop: while (rest.length) {
    for (const k in kinds) {
      const m = kinds[k].exec(rest);
      if (!m) continue;
      rest = rest.slice(m[0].length);
      if (k === 'gap') continue loop;
      const extra = [];
      for (let i = 1; i < m.length; i++) extra.push(m[i] ?? null);
      out.push({ k, text: m[0], extra });
      continue loop;
    }
    out.push({ k: 'bad', text: rest[0], extra: [] });
    rest = rest.substring(1);
  }
  return out;
}
function fields(line, shape) { let m, out = []; switch (shape) { case 'pair': m = /^(\w+)\s*[:=]\s*(.*)$/.exec(line); break; case 'list': m = /^[-*] (?:\[(x| )\] )?(.*)$/.exec(line); break; case 'head': m = /^(#+) (.*?)(?: \{(\w+)\})?$/.exec(line); break; default: m = line.match(/(\S+)(?: (\S+))?(?: (\S+))?/); } if (m) for (let i = 1, n = m.length; i < n; i++) out.push(m[i]); return out; }
module.exports = { Table, tokens, fields, TABLE };
