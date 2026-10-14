// `useRef` yields an object that React makes: an ordinary object, looked at as what the declaration says.
import { breakContract, createContext, keepContract, render, useContext, useRef } from "react"
interface Theme { color: string; depth: number }
const Themed = createContext<Theme>({ color: "red", depth: 1 })
function Panel(props: { name: string }): string {
  const renders = useRef(0)
  const last = useRef<string | null>(null)
  const theme = useContext(Themed)
  renders.current += 1
  const before = last.current
  last.current = props.name
  const inner = (): string => theme.color + (theme.depth + renders.current)
  return inner() + " " + before + " " + last.current
}
console.log(render(Panel, { name: "a" }))
console.log(render(Panel, { name: "b" }))
breakContract("text")
try { console.log(render(Panel, { name: "c" })) } catch (e) { console.log((e as Error).constructor.name) }
keepContract()
console.log(render(Panel, { name: "d" }))
