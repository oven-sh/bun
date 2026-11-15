// A loop replaces an array in each iteration by one whose elements are of other types, and only the code behind the loop reads it.
// STATISTIC: MergedArraysWidened >= 2
var alphabet = ["A", "B"], keep = [];
alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function decode(data) {
  try { var out = globalThis.hidden.atob(data); } catch (error) {
    var out = "", length = data.length;
    if (length > 3 && length % 4 == 0) {
      var bits = [0, 0, 0, 0], index = 0;
      while (index < length) {
        bits = [alphabet.indexOf(data.charAt(index++)), alphabet.indexOf(data.charAt(index++)), alphabet.indexOf(data.charAt(index++)), alphabet.indexOf(data.charAt(index++))];
        out += String.fromCharCode((bits[0] << 2) | (bits[1] >> 4)) + String.fromCharCode(((bits[1] & 15) << 4) | (bits[2] >> 2)) + String.fromCharCode(((bits[2] & 3) << 6) | bits[3]);
      }
      if (bits[3] >= 64) { out += "!"; if (bits[2] >= 64) out += "?"; }
    }
  }
  return out;
}
function unknown(i) { return i % 3 === 0 ? i : i % 3 === 1 ? "s" + i : { valueOf() { return i; } }; }
function last(n) { let p = [0, 0]; for (let i = 0; i < n; i++) p = [unknown(i), i]; return String(p[0] > 1) + typeof p[0] + p[1] + p.length; }
function kept(n) { let p = [0, 0]; for (let i = 0; i < n; i++) { p = [unknown(i), i]; if (i === 2) keep.push(p); } p[1] = "after"; return keep.map(q => q[1]).join(); }
function read(n) { let p = [0, 0], s = ""; for (let i = 0; i < n; i++) { s += typeof p[0]; p = [unknown(i), i]; } return s + p.join(); }
function sometimes(n) { let p = [1, 2]; for (let i = 0; i < n; i++) if (i & 1) p = [unknown(i), p[0]]; return typeof p[0] + typeof p[1]; }
for (const text of ["QUJD", "QUJDRA==", "QUJDREU=", "", "QUJ", "QUJDREVGR0hJSktM"]) console.log(JSON.stringify(decode(text)));
for (const n of [0, 1, 2, 3, 7]) console.log(last(n), kept(n), read(n), sometimes(n));
