// A table of 64 rows is mapped to patterns by an arrow that begins with a test of the row: `if (row.mark === undefined)`. The walk that works the patterns' texts out answers such a test with few
// values (64); to answer it for "the row" it goes through the rows, and came to the end of those values at row 53. The test was given up, as it should be; but the walk had noted, for going
// through them one at a time, the rows it had seen so far, and that note stayed: the walk went through 53 rows, took them for all, and the patterns of the last eleven were interpreted.
// In a large program these were the last nine rows of a table of 64, all plain texts. (Some rows' texts are put together of parts, so that the table is no constant as a whole.)
// The two calls are warned of for their flags, which hang on a parameter; `g` finds the record without flags.
// COUNTER: RegExpsCreatedWithoutRecord = 0
// COUNTER: RegExpsCompiledToBytecode = 0
// COUNTER: RegExpMatchesInterpreted = 0
import { compile } from "./table"
class Scanner {
  #all?: ReturnType<typeof compile>
  #one?: ReturnType<typeof compile>
  all() {
    return (this.#all ??= compile(true))
  }
  one() {
    return (this.#one ??= compile(false))
  }
}
const scanner = new Scanner()
const show = (list: ReturnType<typeof compile>) => list.map(each => (each.whole ? each.whole.source + "/" + each.whole.flags : "-") + " " + (each.first ? each.first.source + "/" + each.first.flags : "-")).join(" | ")
console.log(show(scanner.all()))
console.log(show(scanner.one()))
console.log(scanner.all().map(each => (each.whole!.test("<x<y z<wab xy qq") ? 1 : 0)).join(""))
