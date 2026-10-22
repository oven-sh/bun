// TypeScript never checks a JSX element against the signature of jsx(), so a key, a tag and children that its written parameters do not allow reach it. They are tested like the arguments of any call: a key or a tag of another kind throws on entry, children of another kind throw where `props.children` is read.
/** @jsxImportSource ./narrow */
import { jsx } from "./narrow/jsx-runtime"
function Item(props: { label: string }): string { return "item " + props.label }
try { console.log(<b key={0}>x</b>) } catch (e) { console.log("a number as the key:", (e as Error).constructor.name) }
try { console.log([5, 6].map((n, i) => <i key={i}>{n}</i>).join(" | ")) } catch (e) { console.log("numbers as the keys of a list:", (e as Error).constructor.name) }
console.log(<b key="k">x</b>)
console.log(<b>x</b>)
try { console.log(<b id={1}>{7}</b>) } catch (e) { console.log("a number as the child:", (e as Error).constructor.name) }
try { console.log(<b>{1}{2}</b>) } catch (e) { console.log("two children:", (e as Error).constructor.name) }
try { console.log(<Item key={3} label="l" />) } catch (e) { console.log("a function as the tag:", (e as Error).constructor.name) }
console.log(jsx("direct", { children: "c" }, "k"))
