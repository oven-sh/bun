// Many adjacent stores that create fields list their keys in the order of the stores, whatever the object has already.
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number }
function show(o: object) { return Object.keys(o).join("") + " " + JSON.stringify(o) }

function fillAll(o: Wide, n: number) {
  o.a = n; o.b = n + 1; o.c = n + 2; o.d = n + 3; o.e = n + 4
  o.f = n + 5; o.g = n + 6; o.h = n + 7; o.i = n + 8; o.j = n + 9
}
function fillBackwards(o: Wide, n: number) {
  o.j = n; o.i = n; o.h = n; o.g = n; o.f = n; o.e = n; o.d = n; o.c = n; o.b = n; o.a = n
}
function fillFive(o: Wide, n: number) {
  o.c = n; o.d = n; o.e = n; o.f = n; o.g = n
}

const empty: Wide = {}
fillAll(empty, 0)
console.log(show(empty))

const backwards: Wide = {}
fillBackwards(backwards, 1)
console.log(show(backwards))

const startsInTheMiddle: Wide = { f: -1 }
fillAll(startsInTheMiddle, 10)
console.log(show(startsInTheMiddle))

const hasTheLast: Wide = { j: -1, e: -2 }
fillAll(hasTheLast, 20)
console.log(show(hasTheLast))

const filledTwice: Wide = {}
fillFive(filledTwice, 3)
fillAll(filledTwice, 30)
fillBackwards(filledTwice, 4)
console.log(show(filledTwice))

const withDeletedFields: Wide = {}
fillAll(withDeletedFields, 40)
delete withDeletedFields.b
delete withDeletedFields.g
delete withDeletedFields.j
fillAll(withDeletedFields, 50)
console.log(show(withDeletedFields))

const withOtherKeys: any = {} as Wide
withOtherKeys.z = "z"
fillFive(withOtherKeys, 5)
withOtherKeys[1] = "one"
fillAll(withOtherKeys, 60)
console.log(show(withOtherKeys))

const sealed: Wide = Object.seal({ a: 1, c: 3 } as Wide)
try { fillAll(sealed, 70) } catch (error) { console.log((error as Error).constructor.name) }
console.log(show(sealed))

const frozen: Wide = Object.freeze({ a: 1 } as Wide)
try { fillFive(frozen, 80) } catch (error) { console.log((error as Error).constructor.name) }
console.log(show(frozen))

class Node {
  declare kind: number; declare pos: number; declare end: number; declare id: number; declare flags: number
  declare parent: Node | undefined; declare original: Node | undefined; declare text: string; declare depth: number
  constructor(kind: number, pos: number, end: number, parent: Node | undefined) {
    this.initialize(kind, pos, end, parent)
  }
  initialize(kind: number, pos: number, end: number, parent: Node | undefined) {
    this.kind = kind; this.pos = pos; this.end = end; this.id = 0; this.flags = 0
    this.parent = parent; this.original = undefined; this.text = "n" + kind; this.depth = parent ? parent.depth + 1 : 0
  }
}
let node: Node | undefined
for (let n = 0; n < 2000; n++) node = new Node(n, n * 2, n * 2 + 1.5, n % 5 ? node : undefined)
console.log(Object.keys(node!).join(), node!.depth, node!.end, node!.parent!.text, JSON.stringify({ ...node!, parent: undefined }))

let wrong = 0
for (let n = 0; n < 1024; n++) {
  const o: Wide = {}
  let expected = ""
  if (n & 1) { o.d = n; expected += "d" }
  if (n & 2) { o.a = n; expected += "a" }
  if (n & 4) { o.j = n; expected += "j" }
  if (n & 8) { o.f = n; expected += "f" }
  if (n & 16) { fillFive(o, n); for (const key of "cdefg") if (!expected.includes(key)) expected += key }
  fillAll(o, n)
  for (const key of "abcdefghij") if (!expected.includes(key)) expected += key
  if (Object.keys(o).join("") !== expected || o.a !== n || o.j !== n + 9) wrong++
}
console.log(wrong)
