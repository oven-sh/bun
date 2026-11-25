'use strict';
const log = [];
function Point(x) { this.x = x; }
function makePoint(x) { return new Point(x); }
const points = [makePoint(5)];
function readPoints() {
  let text = '';
  for (const p of points) text += [p.low, p.high] + ';';
  return text;
}
log.push(readPoints());
Object.defineProperty(Point.prototype, 'high', { get() { return this.x + 1; } });
points.push(makePoint(1));
log.push(readPoints());
Object.defineProperty(Point.prototype, 'low', { get() { return this.x - 1; } });
log.push(readPoints());

function Size(x) { this.x = x; }
function makeSize(x) { return new Size(x); }
const sizes = [makeSize(5)];
function readSizes() {
  let text = '';
  for (const s of sizes) text += [s.low, s.high, s.twice] + ';';
  return text;
}
log.push(readSizes());
Object.defineProperty(Size.prototype, 'twice', { get() { return this.x * 2; } });
log.push(readSizes());
Object.defineProperty(Size.prototype, 'low', { get() { return this.x - 1; } });
sizes.push(makeSize(1));
log.push(readSizes());
Object.defineProperty(Size.prototype, 'high', { get() { return this.x + 1; } });
log.push(readSizes());

// One of the names changes before the last one comes.
function Span(x) { this.x = x; }
function makeSpan(x) { return new Span(x); }
const spans = [makeSpan(5)];
function readSpans() {
  let text = '';
  for (const s of spans) text += [s.low, s.high] + ';';
  return text;
}
log.push(readSpans());
Object.defineProperty(Span.prototype, 'low', { get() { return this.x - 1; }, configurable: true });
Object.defineProperty(Span.prototype, ['l', 'o', 'w'].join(''), { get() { return 'other'; } });
log.push(readSpans());
Object.defineProperty(Span.prototype, 'high', { get() { return this.x + 1; } });
log.push(readSpans());
console.log(log.join('\n'));
