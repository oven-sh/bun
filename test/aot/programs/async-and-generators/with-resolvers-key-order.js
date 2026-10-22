// The object Promise.withResolvers returns: its keys in creation order, its prototype, and functions that settle its promise.
const first = Promise.withResolvers()
console.log(Object.keys(first).join(), Object.getPrototypeOf(first) === Object.prototype, first.promise instanceof Promise, typeof first.resolve, typeof first.reject)
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(first, "promise"), (key, value) => (key === "value" ? "promise" : value)))

const { promise, resolve } = Promise.withResolvers()
resolve(1)
const rejected = Promise.withResolvers()
rejected.reject(new Error("no"))
console.log(await promise, await rejected.promise.catch(error => error.message))

first.extra = 2
delete first.reject
console.log(Object.keys(first).join())
first.resolve("late")
console.log(await first.promise)

class Tracked extends Promise {}
const tracked = Promise.withResolvers.call(Tracked)
tracked.resolve(3)
console.log(tracked.promise instanceof Tracked, Object.keys(tracked).join(), await tracked.promise)
