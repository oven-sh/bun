// A function expression annotated with a type that has several call signatures returns what each of them promises, not what the first one does.
type Cookie = Record<string, string>
interface GetCookie { (header: string, key: string): string | undefined; (header: string): Cookie }
function parse(header: string): Cookie { const all: Cookie = {}; for (const pair of header.split("; ")) { const at = pair.indexOf("="); all[pair.slice(0, at)] = pair.slice(at + 1) } return all }
const getCookie: GetCookie = (header, key?) => { const all = parse(header); if (typeof key === "string") return all[key]; return all as any }
console.log(getCookie("session=8d1f; theme=dark", "theme"), JSON.stringify(getCookie("session=8d1f; theme=dark")))
interface Point { x: number; y: number }
interface Convert { (text: string): number; (n: number): string; (p: Point): Point }
const convert: Convert = (value: any): any => typeof value === "string" ? value.length + 0.5 : typeof value === "number" ? "n" + value : { x: value.y, y: value.x }
const unannotated: Convert = ((value: string | number | Point) => typeof value === "string" ? value.length + 0.5 : typeof value === "number" ? "n" + value : { x: value.y, y: value.x }) as Convert
console.log(convert("abc"), convert(2), convert({ x: 1.5, y: 2.5 }).x, unannotated("abc"), unannotated(2), unannotated({ x: 1.5, y: 2.5 }).y)
const table: { pick: { (i: number): number; (k: string): string } } = { pick: (k: any) => k }
console.log(table.pick(1.5), table.pick("k"))
function run(f: { (a: number): number; (a: string): boolean }) { return [f(1.5), f("s")].join() }
console.log(run((a: any): any => typeof a === "number" ? a * 2 : a === "s"))
class Box { get: { (): number; (fallback: string): string } = (fallback?: string): any => fallback ?? 7.5 }
console.log(new Box().get(), new Box().get("f"))
type One = (a: number) => number
const one: One = a => a + 0.5
console.log(one(1))
