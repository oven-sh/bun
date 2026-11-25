// `for (good in shop) if (.. && !sold.hasOwnProperty(good)) ..`: the function is found by a closed call, and the caches of the run time answer: the operation that files an answer is entered for the first questions and no more. The function of the host would never enter it.
// COUNT: operation:operationAOTHasOwnByValAndCache <= 60
var sold: any = { salt: true, milk: true }
function fill(shop: any): any {
  const basket: any = {}
  let room = 8
  for (const good in shop) if (room > 0 && !sold.hasOwnProperty(good)) {
    basket[good] = shop[good]
    room--
  }
  return basket
}
let goods = 0
for (let turn = 0; turn < 20000; turn++) {
  const basket = fill(turn % 2 ? { salt: turn, bread: 10, cheese: "old" } : { milk: null, tea: true })
  goods += Object.keys(basket).length
  if (basket.hasOwnProperty("salt") || basket.hasOwnProperty("milk") || !basket.hasOwnProperty(turn % 2 ? "bread" : "tea")) throw new Error("a good is where it should not be")
}
console.log(goods)
