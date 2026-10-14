// A variable of type `number | bigint` that was found to hold a number is assigned a BigInt by other code.
let x: number | bigint = 1
let y: number | bigint = 2
function flip(): void { x = 5n; y = 3n }
function look(): void {
  if (typeof x !== "number" || typeof y !== "number") return
  console.log(~x, -x, x - y, x * y, x | y, x + y, x ** y, x << y)
  flip()
  console.log(String(~x), String(-x), String(x - y), String(x * y), String(x / y), String(x % y), String(x ** y), String(x + y))
  console.log(String(x | y), String(x & y), String(x ^ y), String(x << y), String(x >> y), typeof (x - y), typeof ~x)
  const kept = x * y
  console.log(String(kept), typeof kept)
  try { console.log(x - 1) } catch (e) { console.log((e as Error).constructor.name) }
}
look()
