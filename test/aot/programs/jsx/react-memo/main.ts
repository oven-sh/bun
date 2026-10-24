// `useMemo` and `useCallback` only cache: they return what the program passed in.
import * as React from "react"
import { breakContract, keepContract, render, useCallback, useMemo as memo } from "react"
interface Row { id: number; name: string }
let made = 0
function List(props: { rows: Row[]; least: number }): string {
  const shown = memo(() => { made++; return props.rows.filter(row => row.id >= props.least) }, [props.rows, props.least])
  const total = React.useMemo(() => shown.reduce((sum, row) => sum + row.id, 0), [shown])
  const first = memo(() => ({ label: shown.length ? shown[0].name : "none", size: shown.length }), [shown])
  const describe = useCallback((row: Row): string => row.name + "#" + row.id, [])
  const inner = (): string => shown.map(describe).join() + " " + (total + 1) + " " + first.label + first.size
  return inner() + " " + typeof describe + " " + made
}
const rows: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }]
console.log(render(List, { rows, least: 2 }))
console.log(render(List, { rows, least: 2 }))
console.log(render(List, { rows, least: 3 }))
for (const lie of ["text", 7, { id: 1 }] as unknown[]) {
  breakContract(lie)
  try { console.log(render(List, { rows, least: 1 })) } catch (e) { console.log((e as Error).constructor.name) }
}
keepContract()
console.log(render(List, { rows, least: 3 }))
