// A pattern that is made at run time has more groups than any that the image holds.
const deep = "(".repeat(300) + "a" + ")".repeat(300);
const pattern = new RegExp(deep, "g");
function at(s) { const m = pattern.exec(s); return m ? m[300] + m.index : "none"; }
console.log(at("xa"), at("xa"), "xaya".replace(pattern, (all, one) => one + "!"), "a".match(new RegExp(deep))[299], [..."aa".matchAll(pattern)].length, "bab".search(new RegExp(deep)), "bab".split(new RegExp(deep)).length, "xaya".replace(new RegExp(deep), "[$1$2$99]"));
