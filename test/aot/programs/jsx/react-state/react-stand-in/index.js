// A stand-in for React in tests: one component instance, hooks by call order. After `breakContract(value)` the hooks return `value` instead of what the program stored, which React never does.
let hooks = [], at = 0, broken = false, instead;
function same(a, b) { return a.length === b.length && a.every((x, i) => Object.is(x, b[i])); }
export function render(component, props) { at = 0; return component(props); }
export function breakContract(value) { broken = true; instead = value; }
export function keepContract() { broken = false; }
export function useMemo(make, deps) {
  const hook = hooks[at++];
  if (broken) return instead;
  if (hook && same(hook.deps, deps)) return hook.value;
  const value = make();
  hooks[at - 1] = { value, deps };
  return value;
}
export function useCallback(callback, deps) { return useMemo(() => callback, deps); }
export function useState(initial) {
  const index = at++;
  if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
  if (broken) return [instead, () => {}];
  return [hooks[index].value, next => { hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next; }];
}
export function useReducer(reducer, initial) {
  const index = at++;
  if (!hooks[index]) hooks[index] = { value: initial };
  if (broken) return [instead, () => {}];
  return [hooks[index].value, action => { hooks[index].value = reducer(hooks[index].value, action); }];
}
export function useRef(initial) {
  const index = at++;
  if (!hooks[index]) hooks[index] = { current: initial };
  return hooks[index];
}
export function createContext(value) { return { value, Provider: "provider", Consumer: "consumer" }; }
export function useContext(context) { return broken ? instead : context.value; }
