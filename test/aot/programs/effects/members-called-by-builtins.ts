// A built-in that calls a member of an operand runs code of the program: each line goes wrong if a read of `count` moves across the call.
// A built-in that only reads a member runs a getter and never calls what the member holds.
class Printed {
  count = 0;
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    this.count++
    return "printed"
  }
}
const printed = new Printed()
const beforeLog = printed.count
console.log(printed)
console.log(beforeLog, printed.count)

class Stamp {
  count = 0
  toISOString(): string {
    this.count++
    return "stamp"
  }
}
const stamp = new Stamp()
const beforeToJSON = stamp.count
console.log(Date.prototype.toJSON.call(stamp), beforeToJSON, stamp.count)

class Joined {
  count = 0
  join(): string {
    this.count++
    return "joined"
  }
}
const joined = new Joined()
const beforeToString = joined.count
console.log(Array.prototype.toString.call(joined), beforeToString, joined.count)

class Amount {
  count = 0
  valueOf(): number {
    this.count++
    return 7
  }
  toString(): string {
    this.count += 10
    return "seven"
  }
}
const amount = new Amount()
const beforeToPrimitive = amount.count
console.log(Date.prototype[Symbol.toPrimitive].call(amount, "number"), beforeToPrimitive, amount.count)
console.log(Date.prototype[Symbol.toPrimitive].call(amount, "string"), amount.count)
console.log(Object.prototype.toLocaleString.call(amount), amount.count)

class Deferred {
  count = 0
  then(onFulfilled: unknown, onRejected: unknown): string {
    this.count++
    return typeof onFulfilled + " " + typeof onRejected
  }
}
const deferred = new Deferred()
const beforeCatch = deferred.count
console.log(Promise.prototype.catch.call(deferred, () => {}), beforeCatch, deferred.count)

const listener = {
  count: 0,
  handleEvent() {
    this.count++
  },
}
const target = new EventTarget()
target.addEventListener("ping", listener)
const beforeDispatch = listener.count
target.dispatchEvent(new Event("ping"))
console.log(beforeDispatch, listener.count)

// join, toString and a sort without a comparator convert what the array holds, at every depth.
let conversions = 0
const element = {
  toString() {
    conversions++
    return "element"
  },
}
const nested = [element, [element, [element]]]
const beforeJoin = conversions
console.log(nested.join("+"), beforeJoin, conversions)
const beforeArrayToString = conversions
console.log(nested.toString(), beforeArrayToString, conversions)
const pair = [element, element]
const beforeSort = conversions
pair.sort()
console.log(beforeSort < conversions)
const words = ["b", "c", "a"]
console.log(words.join(""), words.toString(), words.sort().join(""), words.toSorted().join("-"))

// Members that are only read.
let calls = 0
const held = () => {
  calls++
}
const defined: Record<string, unknown> = {}
Object.defineProperty(defined, "method", { value: held })
console.log(calls, defined.method === held)
console.log(calls, new Error("message", { cause: held }).cause === held)

let reads = 0
const descriptor = {
  get value() {
    reads++
    return "computed"
  },
}
const beforeDefine = reads
Object.defineProperty(defined, "computed", descriptor)
console.log(beforeDefine, reads, defined.computed)

// The length of an array-like is read and then converted.
let lengths = 0
const arrayLike = {
  length: {
    valueOf() {
      lengths++
      return 1
    },
  },
  0: "only",
}
const beforeLength = lengths
console.log(Array.prototype.join.call(arrayLike), beforeLength, lengths)
