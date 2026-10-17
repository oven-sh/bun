// Numbers at the edge of 2^53.
function next(a: number): number { return a + 1 }
console.log("before")
console.log("next", next(9007199254740992))
console.log("after")
