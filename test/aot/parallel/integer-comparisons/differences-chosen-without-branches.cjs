// a < b ? 0 : a - b without a sign is the difference, or nothing.
// STATISTIC: NumbersChosenWithoutBranches >= 4
(function () {
  var edges = [0, 1, 2, 5, 127, 128, 255, 32767, 32768, 65534, 65535, 65536, 2147483646, 2147483647, -2147483648, -2147483647, -65536, -2, -1];
  function slide(heads, by) {
    by = by | 0;
    var at = heads.length | 0, value = 0, kept = 0;
    do {
      at = at - 1 | 0;
      value = heads[at] | 0;
      if (value >>> 0 < by >>> 0)
        kept = 0;
      else
        kept = value - by & 65535;
      heads[at] = kept;
    } while (at);
  }
  function above(words, by, out) {
    by = by | 0;
    for (var i = 0; i < words.length; i++) {
      var value = words[i] | 0, rest;
      if (value >>> 0 > by >>> 0)
        rest = value - by | 0;
      else
        rest = 0;
      out[i] = rest;
    }
  }
  function notBelow(words, by, out) {
    by = by | 0;
    for (var i = 0; i < words.length; i++) {
      var value = words[i] | 0, rest = 0;
      if (by >>> 0 <= value >>> 0)
        rest = value - by | 0;
      out[i] = rest;
    }
  }
  function otherWay(words, by, out) {
    by = by | 0;
    for (var i = 0; i < words.length; i++) {
      var value = words[i] | 0, rest;
      if (by >>> 0 > value >>> 0)
        rest = by - value | 0;
      else
        rest = 0;
      out[i] = rest ^ i;
    }
  }
  function carried(words, by) {
    by = by | 0;
    var left = by;
    for (var i = 0; i < words.length; i++) {
      var taken = words[i] | 0;
      if (left >>> 0 < taken >>> 0)
        left = 0;
      else
        left = left - taken | 0;
    }
    return left;
  }
  function wrongWay(words, by, out) {
    by = by | 0;
    for (var i = 0; i < words.length; i++) {
      var value = words[i] | 0, rest;
      if (value >>> 0 < by >>> 0)
        rest = value - by | 0;
      else
        rest = 0;
      out[i] = rest;
    }
  }
  function signed(words, by, out) {
    by = by | 0;
    for (var i = 0; i < words.length; i++) {
      var value = words[i] | 0, rest;
      if (value < by)
        rest = 0;
      else
        rest = value - by | 0;
      out[i] = rest;
    }
  }
  var log = [];
  for (var by of edges) {
    var heads = new Uint16Array(edges), words = new Int32Array(edges), out = new Int32Array(edges.length);
    slide(heads, by);
    log.push(by + " slide " + heads.join());
    for (var each of [above, notBelow, otherWay, wrongWay, signed]) {
      each(words, by, out);
      log.push(each.name + " " + out.join());
    }
    log.push("carried " + carried(words, by) + " " + carried(new Int32Array([1, 2, 3, 65535]), by));
  }
  console.log(log.join("\n"));
})();
