(function () {
  var view = new Uint16Array(8), count = 0, list = [1, 2, 3, 4], pending = [];
  function bump(i) { view[i & 7] += i; count++; list[i & 3] = view[(i + 1) & 7]; return (view[i & 7] + count + list[(i + 2) & 3]) & 0xffff; }
  function flush() { while (pending.length) console.log(String(eval(pending.pop()))); }
  function run(k) { var n = 0; for (var i = 0; i < k; i++) { try { n = (n + bump(i)) & 0xffff; } catch (error) { n = error.name.length; } if (i % 60 === 59) flush(); } return n; }
  console.log(run(400), count);
  pending.push("count = 'x'", "view = new Float32Array(8); 'floats'", "var fresh = 5; fresh", "bump = (old => i => old(i) + 1)(bump); 'wrapped'");
  console.log(run(400), count, typeof fresh);
  pending.push("list = Object.freeze([9, 9, 9, 9]); 'frozen'", "view = undefined", "count = 7");
  console.log(run(400), count, typeof view);
})();
