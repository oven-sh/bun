// Parsed JSON is stored into the fields of an object that the program creates.
type Def = { id: string; held?: () => boolean }
type Plan = { slot: Def | null; overflow: number }
type State = { winner: Def | null; rule: { flag: boolean } | null; released: boolean; label: string | null }
const state: State = { winner: null, rule: null, released: false, label: null }
function getState(): State { return state }
function planOf(items: Def[], rule: { flag: boolean }): Plan {
  let slot: Def | null = null
  let overflow = 0
  for (const item of items) {
    if (slot === null && (rule.flag || item.held === undefined)) slot = item
    else overflow++
  }
  return { slot, overflow }
}
function choose(items: Def[], options: { flag: boolean }): Plan {
  const s = getState()
  const rule = s.rule ?? options
  const plan = planOf(items, rule)
  if (plan.slot !== null) {
    s.winner = plan.slot
    s.rule = { flag: rule.flag }
    s.label = plan.slot.id
  }
  return plan
}
const made: Def[] = [{ id: "made", held: () => true }, { id: "second" }]
const given = JSON.parse('[{"id":"given"},{"id":7,"extra":[1]},{"id":"third"}]') as Def[]
const options = JSON.parse('{"flag":false}') as { flag: boolean }
function show(plan: Plan) {
  const s = getState()
  console.log(JSON.stringify(plan), JSON.stringify(s), s.winner === plan.slot, typeof s.label)
}
show(choose(made, { flag: true }))
show(choose(made, options))
show(choose(given, options))
show(choose(given.slice(1), { flag: false }))
state.rule = null
show(choose(given.slice(1), JSON.parse('{"flag":"yes"}')))
show(choose([], options))
