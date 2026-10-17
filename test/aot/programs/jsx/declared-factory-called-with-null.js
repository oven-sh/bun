// Classic JSX runtime: the typed factory function is also called directly, with null.
/** @jsxRuntime classic */ /** @jsx h */
function h(t, p) { return [typeof t, t.x, typeof p].join(" | "); }
console.log(h({ x: 1 }, null)); console.log(h({ x: 2 }, null));
console.log(<a />);
console.log(<a k="v" />);
