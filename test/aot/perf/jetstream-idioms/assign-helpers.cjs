// Copies of an object by Object.assign({}, object) under the names that compilers give it.
var __assign = (this && this.__assign) || function () {
  __assign = Object.assign || function (t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
      s = arguments[i];
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
    }
    return t;
  };
  return __assign.apply(this, arguments);
};
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const assign = Object.assign;
const lines = [];
for (let i = 0; i < 64; i++) lines.push({ line: "abc" + i, indent: i & 7, locked: false, start: i & 3, end: 4 + (i & 3) });
const loops = {
  "Object.assign({}, line)": n => { let sum = 0; for (let i = 0; i < n; i++) { const copy = Object.assign({}, lines[i & 63]); copy.locked = true; sum = (sum + copy.indent + copy.end) | 0; } return sum; },
  "assign({}, line)": n => { let sum = 0; for (let i = 0; i < n; i++) { const copy = assign({}, lines[i & 63]); copy.locked = true; sum = (sum + copy.indent + copy.end) | 0; } return sum; },
  "__assign({}, line)": n => { let sum = 0; for (let i = 0; i < n; i++) { const copy = __assign({}, lines[i & 63]); copy.locked = true; sum = (sum + copy.indent + copy.end) | 0; } return sum; },
  "_extends({}, line)": n => { let sum = 0; for (let i = 0; i < n; i++) { const copy = _extends({}, lines[i & 63]); copy.locked = true; sum = (sum + copy.indent + copy.end) | 0; } return sum; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
