// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="Library"
// CHECK-LABEL: function {{*}}name="lends"
// CHECK-LABEL: function {{*}}name="take"

// FILE: main.ts
// A generic async method keeps its resolver in a map; another method settles it later with what an untyped package's read() returns. The caller, a method of the same class, awaits it with an explicit type argument that is a record type. Nothing in the program creates an object of that type; its only namesake is the literal handed to the untyped package. The answer matches the type and must be accepted, as in plain Bun.
import { anything, record, type Form } from './forms.js'
type Slip = { shelf?: number; title?: string; lent?: unknown }
type Reader<T> = { take: (book: T) => void; leave: (why: unknown) => void; form: Form | undefined }

class Library {
  private readonly readers = new Map<number, Reader<unknown>>()
  private seats = 40

  comes(parcel: string): void {
    const { seat, missing, book } = JSON.parse(parcel)
    const reader = this.readers.get(seat)
    if (reader === undefined) return
    if (missing !== undefined) reader.leave(new RangeError(missing))
    else reader.take(reader.form === undefined ? null : reader.form.read(book))
  }

  private async fetches<Book>(words: string[], form: Form): Promise<Book> {
    const seat = ++this.seats
    const book = await new Promise<Book>((read, leave) => {
      this.readers.set(seat, { take: given => read(given as Book), leave, form })
      queueMicrotask(() => this.comes('{"book": {"stamp": 3, "slip": {"shelf": 7, "lent": ' + JSON.stringify(words) + '}}, "seat": ' + seat + '}'))
    })
    this.readers.delete(seat)
    return book
  }

  async lends(title: string, slip: Slip): Promise<string> {
    const fields = { slip: anything() as Form<Slip>, stamp: anything() as Form<number> }
    const lent = await this.fetches<{ slip: Slip; stamp: number }>([title, slip.title ?? 'no title'], record(fields))
    return lent.stamp + 1 + ' ' + JSON.stringify(lent.slip)
  }
}
console.log(await new Library().lends('tides', { shelf: 1, title: 'harbors' }))

// FILE: forms.d.ts
export type Form<T = unknown> = { read(given: unknown): T }
export function record(fields: Record<string, Form>): Form
export function anything(): Form<any>

// FILE: forms.js
export function record(fields) {
  const names = Object.keys(fields)
  return { read: given => Object.fromEntries(names.filter(name => name in given).map(name => [name, given[name]])) }
}
export function anything() {
  return { read(given) { return given } }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
