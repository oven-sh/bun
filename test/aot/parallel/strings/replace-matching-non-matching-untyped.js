// Flags: --aot-validate
// Replace matching and non matching untyped.
const g = globalThis;
const collect = g.fullGC ? () => {
  g.fullGC();
  g.fullGC();
} : () => {
  g.Bun.gc(!0);
  g.Bun.gc(!0);
};
function rep(s, r, x) {
  return s.replace(r, x);
}
const reps = [rep];
function sum(s) {
  let h = 0;
  for (let i = 0;i < s.length; i++)
    h = h * 31 + s.charCodeAt(i) | 0;
  return h;
}
function statics() {
  const R = RegExp;
  return R.lastMatch + "," + R.$1 + "," + R.$2 + "," + R.leftContext.length;
}
const literals = [/b+/, /b+/g, /B+/i, /B+/gi, /^b/m, /b$/gm, /a.b/s, /a.b/, /\u{62}c/u, /\u{62}c/gu, /b/y, /b/gy, /(b)(c)?/, /(b)(c)?/g, /(?<n>b)\k<n>/, /(?<n>b)\k<n>/g, /(?<=a)b/, /(?<=a)b/g, /(?=(b+))\1c/, /[^\x00-\x7f]/, /[^\x00-\x7f]/g, /zzzzzzzzzzzzzzzzzzzz/, /z/g, /z/, /^(?:foo|bar)$/, /x*/, /x*/g, /(?:)/, /(?:)/g, /\d{3,}/g, /a{40}/, /a{40}/g, /[bq][bq]c/, /[bq][bq]c/gi, /\babc\b/, /(a|ab)(c|bcd)(d*)/, /^$/, /^$/g, /b+?c/d, /[\w-]+@[\w-]+/g];
const salt = String(Date.now()).length > 3 ? "" : "never";
const made = [new RegExp(salt + "b+"), new RegExp(salt + "b+", "g"), new RegExp(salt + "(b)(c)?", "gi"), new RegExp(salt + "qq[a-f]{2}", "g"), new RegExp(salt + "z")];
function joined(w) {
  let a = "", b = "";
  for (let i = 0;i < w.length; i++)
    if (i < 2)
      a += w[i];
    else
      b += w[i];
  return a + b;
}
const wide = "\u4E00";
const flat = ["", "a", "abc", "abbbc", "xyz", "ABBC", `a
b`, "foo", "bar", "123", "12", "me@there and you@here", "qbc QBC", "abcd", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyabbc", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"];
const subjects = [];
for (const s of flat)
  subjects.push(["flat " + s.length, () => s]);
for (const s of ["abbbc", "xyzxyz", "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyybb"])
  subjects.push(["rope " + s.length, () => joined(s)]);
for (const s of ["ab" + wide, wide, "xy" + wide + "z", wide + "abbc"])
  subjects.push(["16 bits " + s.length, () => s]);
const replacements = ["", "X", "[$&]", "$1-$2", "$<n>$$"];
const indices = [0, 2, 100, -1, 1.5, NaN];
function all(name, rs) {
  for (const r of rs) {
    let line = "";
    for (const [, make] of subjects)
      for (const x of replacements)
        for (const at of indices) {
          r.lastIndex = at;
          const out = reps[0](make(), r, x);
          line += out + "|" + r.lastIndex + "|" + statics() + ";";
        }
    console.log(name + " " + r.source.slice(0, 24) + " /" + r.flags + " " + line.length + " " + sum(line));
  }
}
all("literal", literals);
all("made", made);
collect();
all("literal, behind two full collections", literals);
function tell(name, f) {
  let out;
  try {
    out = f();
  } catch (e) {
    out = "threw " + e.name + ": " + e.message;
  }
  console.log(name + ": " + out);
}
function state(r) {
  return "|" + String(r.lastIndex) + "|" + statics();
}
const log = [];
for (const s of ["xyz", "abbc"])
  for (const flags of ["", "g"]) {
    const fresh = () => new RegExp("b+", flags);
    tell(s + " /" + flags + " frozen", () => {
      const r = Object.freeze(fresh());
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " frozen literal", () => {
      const r = Object.freeze(flags ? /b+c/g : /b+c/);
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " sealed", () => {
      const r = Object.seal(fresh());
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " lastIndex not writable", () => {
      const r = fresh();
      Object.defineProperty(r, "lastIndex", { writable: !1, value: 1 });
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " an own property", () => {
      const r = fresh();
      r.mine = 1;
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " an own exec", () => {
      const r = fresh();
      let n = 0;
      r.exec = function() {
        n++;
        return null;
      };
      return reps[0](s, r, "X") + state(r) + " asked " + n;
    });
    tell(s + " /" + flags + " lastIndex a string", () => {
      const r = fresh();
      r.lastIndex = "1";
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " lastIndex an object", () => {
      const r = fresh();
      let n = 0;
      r.lastIndex = { valueOf() {
        n++;
        return 1;
      } };
      return reps[0](s, r, "X") + "|" + typeof r.lastIndex + " asked " + n;
    });
    tell(s + " /" + flags + " lastIndex undefined", () => {
      const r = fresh();
      r.lastIndex = void 0;
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " a subclass", () => {

      class Mine extends RegExp {
      }
      const r = new Mine("b+", flags);
      return reps[0](s, r, "X") + state(r);
    });
    tell(s + " /" + flags + " a subclass with exec", () => {
      let n = 0;

      class Mine extends RegExp {
        exec(t) {
          n++;
          return super.exec(t);
        }
      }
      const r = new Mine("b+", flags);
      return reps[0](s, r, "X") + state(r) + " asked " + n;
    });
    tell(s + " /" + flags + " compiled anew", () => {
      const r = fresh();
      reps[0](s, r, "X");
      r.compile("y+", flags);
      return reps[0](s, r, "X") + "," + reps[0]("abbc", r, "X") + state(r);
    });
    tell(s + " /" + flags + " no prototype", () => {
      const r = fresh();
      Object.setPrototypeOf(r, null);
      return reps[0](s, r, "X");
    });
  }
console.log(log.length);
