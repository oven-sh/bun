// A step of a for..of loop over an array runs a getter that the loop body put there, and the getter changes an object the loop reads.
class Scale {
    factor: number | string = 2
}

type Change = (values: (number | undefined)[], scale: Scale) => void

function replaceFactor(scale: Scale, factor: string): void {
    const untyped = scale as any
    delete untyped.factor
    untyped.other = 1
    untyped.factor = factor
}

function walk(values: (number | undefined)[], scale: Scale, change: Change): string {
    const seen: unknown[] = []
    for (const value of values) {
        seen.push(scale.factor, value)
        change(values, scale)
        seen.push(scale.factor)
    }
    return seen.join()
}

const defineElementGetter: Change = (values, scale) => {
    if (Object.getOwnPropertyDescriptor(values, 2)?.get) return
    Object.defineProperty(values, 2, {
        get() {
            replaceFactor(scale, "own getter")
            return 30
        },
    })
}

const changePrototype: Change = (values, scale) => {
    if (Object.getPrototypeOf(values) !== Array.prototype) return
    Object.setPrototypeOf(values, {
        __proto__: Array.prototype,
        get 1() {
            replaceFactor(scale, "inherited getter")
            return 20
        },
    })
}

console.log(walk([10, 20, 3], new Scale(), () => {}))
console.log(walk([10, 20, 3], new Scale(), defineElementGetter))
console.log(walk([10, , 30], new Scale(), changePrototype))
console.log(walk([10, 20, 3], new Scale(), () => {}))
