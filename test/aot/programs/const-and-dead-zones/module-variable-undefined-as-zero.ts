// A module variable that starts undefined, tested before and after stores.
let cache: object | undefined
let nullable: object | null | undefined

function describeCache() {
  return [cache == null, cache === undefined, !cache].join(" ")
}

function describeNullable() {
  return [nullable == null, nullable === undefined, nullable === null, !nullable].join(" ")
}

console.log("before a store", describeCache())
cache = {}
console.log("after a store", describeCache())
cache = undefined
console.log("after a store of undefined", describeCache())

console.log("nullable before a store", describeNullable())
nullable = {}
console.log("nullable after a store", describeNullable())
nullable = null
console.log("nullable after a store of null", describeNullable())
nullable = undefined
console.log("nullable after a store of undefined", describeNullable())
