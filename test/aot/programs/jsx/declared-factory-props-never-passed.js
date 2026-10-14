// JSX with the classic runtime: declared factory props never passed.
/** @jsxRuntime classic */ /** @jsx h */
function h(t, p, ...c) { return [t, p === null ? "null" : typeof p, p && p.k, c.length].join(" | "); }
console.log(h("x"));
console.log(<a k="v">text</a>);
