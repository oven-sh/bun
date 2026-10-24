// React's hooks return what the program stored, like `Map.get`.
import * as React from "react"
import { breakContract, keepContract, render, useReducer, useState as state } from "react"
interface Row { id: number; name: string }
type Action = { kind: "add"; row: Row } | { kind: "clear" }
function Counter(props: { step: number }): string {
  const [count, setCount] = state(0)
  const [label, setLabel] = React.useState<string | null>(null)
  const [first] = state(() => ({ made: "once", size: props.step }))
  const [rows, dispatch] = useReducer((rows: Row[], action: Action): Row[] => action.kind === "add" ? [...rows, action.row] : [], [])
  const bump = (): void => {
    setCount(previous => previous + props.step)
    setLabel("n" + count)
    dispatch({ kind: "add", row: { id: count * 2, name: "r" + count } })
  }
  bump()
  return count + 1 + " " + label + " " + first.made + first.size + " " + rows.map(row => row.name + (row.id + 1)).join()
}
console.log(render(Counter, { step: 2 }))
console.log(render(Counter, { step: 3 }))
console.log(render(Counter, { step: 1 }))
for (const lie of ["text", { id: 1 }] as unknown[]) {
  breakContract(lie)
  try { console.log(render(Counter, { step: 1 })) } catch (e) { console.log((e as Error).constructor.name) }
}
// The type argument of `state(0)` is inferred, so nothing is tested: the value goes on as it is.
function Only(_: {}): string { const [count] = state(0); return "only " + (count + 1) }
try { console.log(render(Only, {})) } catch (e) { console.log((e as Error).constructor.name) }
keepContract()
console.log(render(Counter, { step: 1 }))
