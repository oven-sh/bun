// With named groups the replacement function receives one more argument: an object that replace and replaceAll allocate.
function swap(match, year, month, offset, whole, groups) {
  return groups.month + "/" + groups.year
}
console.log("2024-05 2025-06".replace(/(?<year>\d+)-(?<month>\d+)/, swap))
console.log("2024-05 2025-06".replace(/(?<year>\d+)-(?<month>\d+)/g, swap))
console.log("2024-05 2025-06".replaceAll(/(?<year>\d+)-(?<month>\d+)/g, swap))

function describeLast(...args) {
  const last = args[args.length - 1]
  return "[" + args.length + " " + typeof last + " " + (typeof last === "object" ? Object.getPrototypeOf(last) + " " + Object.keys(last) + " " + JSON.stringify(last) : last) + "]"
}
console.log("ab".replace(/(?<first>a)(?<second>x)?/, describeLast))
console.log("ab".replaceAll(/(?<letter>[ab])/g, describeLast))
console.log("ab".replace(/(a)(x)?/, describeLast))
console.log("ab".replace("a", describeLast))
console.log("abab".replaceAll("b", describeLast))

const kept = []
function keep(match, letter, offset, whole, groups) {
  groups.offset = offset
  kept.push(groups)
  return letter.toUpperCase()
}
console.log("abc".replace(/(?<letter>[a-c])/g, keep), kept.length, kept[0] === kept[1], JSON.stringify(kept))

let total = 0
for (let i = 0; i < 200; i++)
  "k1=v1;k2=v2".replace(/(?<key>\w+)=(?<value>\w+)/g, (match, key, value, offset, whole, groups) => { total += groups.key.length + groups.value.length + offset; return "" })
console.log(total)

class Loud extends RegExp {
  exec(string) {
    const result = super.exec(string)
    if (result) result.groups = { shout: result[0].toUpperCase() }
    return result
  }
}
console.log("abc".replace(new Loud("b"), (match, offset, whole, groups) => groups.shout + offset))
console.log(RegExp.prototype[Symbol.replace].call(/(?<x>b)/, "abc", (match, x, offset, whole, groups) => "<" + groups.x + ">"))
