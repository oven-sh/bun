// Classic JSX runtime: the typed factory function is also called directly, with integers.
/** @jsxRuntime classic */ /** @jsx h */
function h(t, p) { let s = 0; for (let i = 0; i < 3; i++) s += t | 0; return [typeof t, s, t + 1].join(" | "); }
console.log(h(1, null)); console.log(h(2, null));
console.log(<a />);
console.log((() => <b />)());
