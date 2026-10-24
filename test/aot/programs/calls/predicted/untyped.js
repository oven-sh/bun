export function run() {
  const log = [];
  function first(a) { return "first " + a; }
  function second(a, b) { return "second " + a + b; }
  const scanner = { position: 0, get: () => scanner.position, advance(n) { scanner.position += n; return this === scanner; } };
  let current = first;
  for (let i = 0; i < 4; i++) {
    log.push(current(i), scanner.get(), scanner.advance(i));
    if (i === 1) { current = second; scanner.get = () => "replaced"; }
    if (i === 2) { current = Math.abs; scanner.advance = function () { return "replaced too " + (this === scanner); }; }
  }
  current = undefined;
  try { current(1); } catch (e) { log.push(e.constructor.name); }
  function Point(x) { this.x = x; }
  let Class = Point;
  for (let i = 0; i < 3; i++) { log.push(new Class(i).x, new Class(i) instanceof Point); if (i === 1) Class = function Other(x) { this.x = -x; }; }
  const makers = [0, 1].map(k => () => k);
  log.push(makers[0](), makers[1]());
  return log;
}
