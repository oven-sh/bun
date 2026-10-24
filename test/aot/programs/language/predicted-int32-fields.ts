// Fields that are expected to hold 32-bit integers: a wrong expectation changes no answer.
interface Source { text: string; skip?: (at: number) => number }
interface Clock { read(): number }
interface Mark { o: number[]; at: number; stamp: number; share: number }
const skipped = (source: Source, at: number) => (source.skip ? source.skip(at) : at + 1)
const made: Mark[] = []
function mark(source: Source, clock: Clock, at: number) { made.push({ o: [at], at: skipped(source, at), stamp: clock.read(), share: at / 4 }) }
const raw: any = {}
raw["re" + "ad"] = () => 1.5
const clock: Clock = raw
for (let i = 0; i < 3; i++) mark({ text: "x" }, clock, i * 2)
console.log(JSON.stringify(made))
