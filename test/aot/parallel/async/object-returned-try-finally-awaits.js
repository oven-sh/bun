// The object that is returned is built behind the finally block, and until then the array in it is carried there. Where the try block throws there is no array to carry, and nothing looks at its place: neither the program nor the checks of a validating build.
// Flags: --aot-validate
async function collect(resource, list, change) { try { return { changed: [...list.map(change)] } } finally { await resource.close() } }
async function keep(resource, list, wanted) { try { return { kept: [...list.filter(wanted)], count: list.length } } finally { await resource.close() } }
const resource = { closed: 0, async close() { this.closed++ } };
const same = value => value, fails = value => { throw new Error("thrown at " + value) };
for (const [name, list, change] of [["first", ["p"], same], ["second", ["q"], fails], ["third", ["r", "s"], same], ["fourth", [], fails]]) {
  try { console.log(name, JSON.stringify(await collect(resource, list, change)), resource.closed) } catch (error) { console.log(name, "caught", error.message, resource.closed) }
  try { console.log(name, JSON.stringify(await keep(resource, list, change)), resource.closed) } catch (error) { console.log(name, "caught", error.message, resource.closed) }
}
