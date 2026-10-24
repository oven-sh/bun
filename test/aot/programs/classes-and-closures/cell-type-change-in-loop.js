// A closure that gets a property and an object that loses its layout change cell type in place. A type test in a loop must see the change.
function one() { return 1 }
function two() { return 2 }
function ten() { return 10 }

function callEach(f, replaceAt) {
  let total = 0
  for (let i = 0; i < 4; i++) {
    total += f.call(null)
    if (i === replaceAt) f.call = ten
  }
  return total
}
console.log(callEach(one, 1), callEach(two, 4))

function applyEach(f, replaceAt) {
  let total = 0
  for (let i = 0; i < 4; i++) {
    total += f.apply(null, [])
    if (i === replaceAt) Object.defineProperty(f, "apply", { value: ten })
  }
  return total
}
function three() { return 3 }
console.log(applyEach(three, 0))

class Point {
  constructor(x, y) {
    this.x = x
    this.y = y
  }
}
function keysEach(point, deleteAt) {
  const seen = []
  for (let i = 0; i < 3; i++) {
    const keys = []
    for (const key in point) keys.push(key)
    seen.push(keys.join(), Object.keys(point).join(), JSON.stringify({ ...point }))
    if (i === deleteAt) delete point.x
  }
  return seen.join(" ")
}
console.log(keysEach(new Point(1, 2), 0))
console.log(keysEach(new Point(3, 4), 3))
