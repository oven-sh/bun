// Nothing is ever put into these collections, so a loop over one of them has no entry to hand to its body.
// The step that would have an entry ends there, and the compiler's own checks hold behind every pass (--aot-check=verify-each-pass).
const observers = new Set()
const handlers = new Map()
const filled = new Set([1, 2, 3])

function notify(entry) {
  let calls = 0
  for (const observer of observers) {
    observer.push(entry)
    calls++
  }
  return calls
}

function dispatch(entry) {
  let calls = 0
  for (const [name, handler] of handlers) calls += handler(name, entry)
  for (const name of handlers.keys()) calls += name.length
  for (const handler of handlers.values()) calls += handler('', entry)
  return calls
}

function copies() {
  return [...observers].length + [...handlers].length + Array.from(observers).length
}

function sum() {
  let total = 0
  for (const number of filled) total += number
  return total
}

let calls = 0
let total = 0
for (let i = 0; i < 3000; i++) {
  calls += notify(i) + dispatch(i) + copies()
  total += sum()
}
console.log(calls, total, observers.size, handlers.size)
