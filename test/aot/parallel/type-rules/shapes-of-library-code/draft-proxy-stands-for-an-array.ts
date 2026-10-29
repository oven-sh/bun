interface State {
  ids: number[];
}
function produce(state: State, recipe: (draft: State) => void): void {
  const draft = new Proxy(state, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      return Array.isArray(value) ? new Proxy(value, {}) : value;
    },
  });
  recipe(draft);
}
const state: State = { ids: [1] };
produce(state, draft => {
  const ids = draft.ids;
  ids.push(2);
  console.log(Array.isArray(ids), ids.length, ids.includes(2));
});
console.log(state.ids.join());
