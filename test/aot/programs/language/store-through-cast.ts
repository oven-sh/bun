// `(v as T) = value` is an assignment to `v`.
let v: number | string = 1
let w: number | string = 2
function flip(): void { (v as number | string) = "text"; (<number | string>w) = "more" }
function look(): void {
  if (typeof v === "number" && typeof w === "number") {
    flip()
    console.log(v + 1, w + 1, typeof v, typeof w)
  }
}
look()
function local(): string {
  let x: number | string = 1
  const set = (): void => { (x as number | string) = "inner" }
  if (typeof x === "number") {
    set()
    return x + 1 + ""
  }
  return "not a number"
}
console.log(local())
