// A call whose argument can never pass the test of the parameter: the last arm of an exhaustive switch hands what is left of the union, which is nothing, to a parameter written `never`.
// The conversion of the argument ends the arm, and the compiler's own checks hold behind every pass (--aot-check=verify-each-pass).
type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number }

function unexpected(value: never, where: string, code: number) {
  return { value, where, code }
}

function describe(shape: Shape): string {
  switch (shape.kind) {
    case 'circle':
      return 'circle ' + shape.radius
    case 'square':
      return 'square ' + shape.side
    default: {
      const report = unexpected(shape, 'describe', 1)
      return report.where + report.code
    }
  }
}

function area(shape: Shape): number {
  if (shape.kind === 'circle') return 3 * shape.radius * shape.radius
  if (shape.kind === 'square') return shape.side * shape.side
  return unexpected(shape, 'area', 2).code
}

let length = 0
let total = 0
for (let i = 0; i < 2000; i++) {
  const shape: Shape = i & 1 ? { kind: 'circle', radius: i } : { kind: 'square', side: i }
  length += describe(shape).length
  total += area(shape)
}
console.log(length, total)
