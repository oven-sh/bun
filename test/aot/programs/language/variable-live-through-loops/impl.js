function server(first, client) {
  let turns = 0, writes = 0;
  const res = { write() { return ++writes % 3 !== 0; }, get writableLength() { return ++turns < 2 ? 0 : 7; }, once(name, f) { f(); } };
  return (async (req, res) => {
    try {
      let written = 0;
      do {
        while (res.write(first)) written += first.length;
        written += first.length;
        await new Promise(resolve => resolve());
      } while (res.writableLength === 0);

      let drained = false;
      res.once("drain", () => (drained = true));
      client.push(written);
      return [written, drained, client.length].join();
    } catch (e) {
      return "caught " + e;
    }
  })(null, res);
}
server("abc", []).then(console.log);
// The walk still ends in a circle of blocks that nothing leads into.
function loopBehindReturn(x) { let v = x; return v; while (true) { v = v + 1; } }
function loopsBehindThrow(x) { let v = x, w = 1; if (x) throw v + w; else return w; do { while (w < v) w++; v--; } while (v > w); return v + w; }
console.log(loopBehindReturn(4), (() => { try { return loopsBehindThrow(2); } catch (e) { return "thrown " + e; } })(), loopsBehindThrow(0));
