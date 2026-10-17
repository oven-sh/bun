// An image holds a thunk for a slow-path operation only if some code of the image calls it.
// THUNKS< 400
type Entry = { name: string; count: number; next?: Entry }
function describe(entry: Entry | undefined): string {
    let text = ""
    for (let e = entry; e; e = e.next) text += e.name + ":" + e.count + ";"
    return text
}
const parsed = JSON.parse('{"name":"a","count":1,"next":{"name":"b","count":2.5}}') as Entry
const made: Entry = { name: "c", count: 3, next: parsed }
made.next!.count += 1
const byName = new Map<string, Entry>()
for (let e: Entry | undefined = made; e; e = e.next) byName.set(e.name, e)
try {
    (undefined as unknown as Entry).name
} catch (error) {
    console.log(error instanceof TypeError)
}
console.log(describe(made), byName.size, [...byName.keys()].join(), Object.keys(parsed).length)
