// Bundlers call an imported function without a receiver: (0, other.splice)(list, ...).
const modules = [
  function (module, exports) {
    Object.defineProperty(exports, "splice", { enumerable: true, get: function () { return splice; } });
    function splice(list, start, remove, items) { list.push(start + remove + items.length); }
  },
  function (module, exports, load) {
    const other = load(0);
    exports.run = function (list, n) { for (let i = 0; i < n; i++) (0, other.splice)(list, i, 2, list); return list; };
    exports.nested = function (list, events) {
      let index = -1;
      while (++index < events.length) {
        let open = index;
        while (open--) {
          if (events[open] !== 9) { (0, other.splice)(list, open - 1, index - open + 3, events); break; }
        }
      }
      return list;
    };
    exports.withReceiver = function (list, n) { for (let i = 0; i < n; i++) list.splice(i, 1, i, n, "x" + i); return list; };
  },
];
function load(id) { const module = { exports: {} }; modules[id](module, module.exports, load); return module.exports; }
const { run, nested, withReceiver } = load(1);
for (let turn = 0; turn < 3; turn++) console.log(run([turn], 4).join(), nested([], [1, 9, 2, 3]).join(), withReceiver([1, 2, 3], 3).join());
