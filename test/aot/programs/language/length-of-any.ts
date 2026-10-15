// `length` of a value declared `any` or `unknown` is whatever the object has under that name.
function last(list: any): number { for (let i = list.length - 1; i >= 0; i--) return i; return -1 }
function count(list: any) { let n = list.length; n++; return n }
function half(list: any) { const n = list.length >> 1; return n }
function ofUnknown(list: unknown) { const n = (list as any).length; return typeof n + n }
function ofArray(list: number[]) { let n = list.length; n--; return n }
function ofEither(list: string | number[]) { const n = list.length; return n + 1 }
const table: any = { last, count, half, ofUnknown }
console.log(table.last(5), table.last({}), table.last([1]), table.last({ length: 2.5 }), table.last("abc"))
console.log(table.count(5), table.count({ length: "a" }), table.count([1, 2]))
console.log(table.half({}), table.half({ length: 7.9 }), table.half([1, 2, 3, 4]))
console.log(table.ofUnknown({}), table.ofUnknown({ length: -0.5 }), table.ofUnknown("ab"))
console.log(ofArray([]), ofArray([1, 2]), ofEither("abc"), ofEither([1]))
