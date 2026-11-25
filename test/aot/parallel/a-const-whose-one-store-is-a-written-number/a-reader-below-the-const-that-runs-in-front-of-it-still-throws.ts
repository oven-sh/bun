// The functions stand BELOW the consts in the text and are hoisted: they are called in front of the stores, between them and behind them. In front, each bare name throws a ReferenceError; behind, it is the value.
const seen: string[] = []
;(globalThis as any).tryAll = tryAll
;(globalThis as any).tryAll("in front")
const LIMIT = 300
;(globalThis as any).tryAll("between")
const LABEL = "label"
const OPEN = true
const NONE = null
;(globalThis as any).tryAll("behind")
console.log(seen.join("\n"))
function tryAll(when: string): void {
  for (const [name, read] of [["limit", limit], ["label", label], ["open", open], ["none", none], ["pair", pair], ["caught", caught], ["method", () => new Box().limit()]] as [string, () => unknown][]) {
    try { seen.push(when + " " + name + " " + String(read())) } catch (e) { seen.push(when + " " + name + " " + (e as Error).constructor.name) }
  }
}
function limit(): number { return LIMIT }
function label(): string { return LABEL }
function open(): boolean { return OPEN }
function none(): null { return NONE }
function pair(): unknown[] { return [LIMIT, LABEL] }
function caught(): string { let out = ""; try { out += LIMIT } catch { out += "no limit" } try { out += LABEL } catch { out += " no label" } return out }
class Box { limit(): number { return LIMIT } }
