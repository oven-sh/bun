// lines of logs read by patterns tried in turn over a window of a larger text; fields by position, rest kept
'use strict';
const patterns = [
  { kind: 'access', re: /^(\S+) (\S+) (\S+) \[([^\]]+)\] "(\S+) (\S+) ([^"]+)" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?$/, fields: ['host', 'ident', 'user', 'time', 'method', 'url', 'proto', 'status', 'bytes', 'ref', 'agent'] },
  { kind: 'syslog', re: /^<(\d{1,3})>(\w{3}\s+\d+ [\d:]+) ([\w.-]+) (\w+)(?:\[(\d+)\])?: (.*)$/, fields: ['pri', 'time', 'host', 'app', 'pid', 'text'] },
  { kind: 'level', re: /^\[(DEBUG|INFO|WARN|ERROR)\](?:\s*\{(\w+)=(\w+)\})? (.*)$/, fields: ['level', 'key', 'value', 'text'] },
  { kind: 'trace', re: /^\s+at (?:(.+?) )?\(?(?:(.+?):(\d+):(\d+))\)?$/, fields: ['fn', 'file', 'line', 'col'] },
  { kind: 'pair', re: /^(\w+)=("(?:[^"\\]|\\.)*"|\S*)(?: (.*))?$/, fields: ['name', 'value', 'more'] }
];
class Reader {
  constructor(text) { this.text = text; this.at = 0; this.lines = 0; this.counts = new Map(); this.kept = []; }
  next() {
    if (this.at >= this.text.length) return null;
    let end = this.text.indexOf('\n', this.at);
    if (end < 0) end = this.text.length;
    const line = this.text.slice(this.at, end);
    this.at = end + 1; this.lines++;
    for (const p of patterns) {
      const m = p.re.exec(line);
      if (m === null) continue;
      const record = { kind: p.kind, line: this.lines };
      for (let i = 1; i < m.length; i++) {
        const v = m[i];
        if (v === undefined || v === '-') continue;
        record[p.fields[i - 1]] = /^\d+$/.test(v) ? Number(v) : v;
      }
      this.counts.set(p.kind, (this.counts.get(p.kind) ?? 0) + 1);
      if (record.kind === 'pair' && record.more) { this.kept.push(m); let rest = record.more, q; record.pairs = {}; while (rest && (q = p.re.exec(rest))) { record.pairs[q[1]] = q[2]; rest = q[3]; } }
      return record;
    }
    return { kind: 'other', line: this.lines, text: line.trim() };
  }
  *[Symbol.iterator]() { for (let r; (r = this.next()) !== null;) yield r; }
}
module.exports = { Reader, patterns, all: text => [...new Reader(text)] };
