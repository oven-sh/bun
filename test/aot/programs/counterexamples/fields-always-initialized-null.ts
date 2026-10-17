// Fields declared `Color | null` hold null in every literal, which is frozen and spread; a later spread stores a color.
declare const console: { log(...values: unknown[]): void };
// The record's first instance is a literal that went through Object.freeze into an annotated constant; later ones are spreads of it (`satisfies`), and the setter spreads again.
type Color = 'red' | 'blue'
type S = { mode: string; message: string | null; color: Color | null; second: Color | null; verb: string }
const INITIAL: S = Object.freeze({ mode: 'a', message: null, color: null, second: null, verb: '' })
function createStore<T>(initial: T) {
  let state = initial
  return { getState: () => state, setState: (f: (p: T) => T) => { state = f(state) } }
}
const store = createStore<Record<string, S>>({})
function update(id: string, reducer: (s: S) => S) {
  store.setState(byId => {
    const cur = byId[id] ?? ({ ...INITIAL, verb: 'v' } satisfies S)
    const next = reducer(cur)
    return next === cur && id in byId ? byId : { ...byId, [id]: next }
  })
}
function setters(id: string) {
  function setMessage(message: string | null): void { update(id, s => (s.message === message ? s : { ...s, message })) }
  function setBoth(color: Color | null, second: Color | null): void {
    update(id, s => (s.color === color && s.second === second ? s : { ...s, color, second }))
  }
  return { setMessage, setBoth }
}
const api = setters('x')
try { api.setMessage(null); api.setBoth('red', 'blue'); console.log(JSON.stringify(store.getState())) } catch (e) { console.log('THROWN: ' + (e as Error).message) }
