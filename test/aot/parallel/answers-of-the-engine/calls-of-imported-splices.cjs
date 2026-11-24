// Bundlers call an imported function without a receiver: (0, other.splice)(list, ...).
const modules = [
  function (module, exports) {
    Object.defineProperty(exports, "splice", { enumerable: true, get: function () { return splice; } });
    function splice(list, from, gone, laid) { list.push(from + gone + laid.length); }
  },
  function (module, exports, load) {
    const other = load(0);
    exports.run = function (list, n) { for (let i = 0; i < n; i++) (0, other.splice)(list, i, 2, list); return list; };
    exports.pairs = function (list, beads) {
      for (let far = beads.length - 1; far > 0; far--) {
        for (let near = 0; near < far; near += 2) {
          if (beads[near] === 9) continue;
          (0, other.splice)(list, near * 2, far + 7, beads);
          if (near > 1) break;
        }
      }
      return list;
    };
    exports.withReceiver = function (list, n) { for (let i = 0; i < n; i++) list.splice(i, 1, i, n, "x" + i); return list; };
  },
];
function load(id) { const module = { exports: {} }; modules[id](module, module.exports, load); return module.exports; }
const { run, pairs, withReceiver } = load(1);
for (let turn = 0; turn < 3; turn++) console.log(run([turn], 4).join(), pairs([], [1, 9, 2, 3]).join(), withReceiver([1, 2, 3], 3).join());
