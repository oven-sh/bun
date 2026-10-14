// Out-of-bounds reads and writes, and missing numbers in arithmetic.
function at(a: number[], i: number): number | undefined { return a[i] }
function plus(a: number[], i: number): number { return a[i] + 1 }
function less(a: number[], i: number): boolean { return a[i] < 5 }
function f64(a: Float64Array, i: number): number { return a[i] * 2 }
function i32(a: Int32Array, i: number): number { return a[i] + 1 }
function hide(x: unknown): any { return x }
function add(x: number | undefined, y: number | null): number { return hide(x) + hide(y) }
const list = [1, 2, 3], floats = new Float64Array(2), ints = new Int32Array(2)
floats[0] = 1.5; floats[5] = 9; ints[1] = 7; ints[-1] = 3; ints[2] = 4
console.log(at(list, 1), at(list, 3), at(list, -1), plus(list, 2), plus(list, 3), less(list, 0), less(list, 9))
console.log(f64(floats, 0), f64(floats, 2), f64(floats, 5), i32(ints, 1), i32(ints, 2), i32(ints, -1), floats.length, ints.length)
console.log(add(1, 2), add(undefined, 2), add(1, null), add(undefined, null))
const grown = [1, 2]
grown[2] = 3; grown[5] = 6
console.log(grown.length, at(grown, 2), at(grown, 3), at(grown, 5), plus(grown, 4))
grown[100000] = 1
console.log(grown.length, at(grown, 100000), at(grown, 99999), at(grown, 1))
