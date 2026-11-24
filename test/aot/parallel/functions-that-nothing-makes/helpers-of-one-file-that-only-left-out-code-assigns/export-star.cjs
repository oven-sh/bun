// A helper of this file that copies exports and that only a function that nobody calls would assign. Calls of it build and throw as in bun run.
var _exportStar;
function init() { _exportStar = function (from, to) {
  Object.keys(from).forEach(function (k) {
    if (k !== "default" && !Object.prototype.hasOwnProperty.call(to, k)) {
      Object.defineProperty(to, k, {
        enumerable: true,
        get: function () {
          return from[k];
        }
      });
    }
  });
  return from;
}; }
const to = {};
try { _exportStar({ a: 1 }, to); console.log(Object.keys(to).join()); } catch (e) { console.log(e.name, typeof _exportStar, Object.keys(to).length); }
