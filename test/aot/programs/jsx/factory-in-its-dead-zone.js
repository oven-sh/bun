// JSX with the classic runtime: factory in its dead zone.
/** @jsxRuntime classic */ /** @jsx h */
const f = () => <a />;
try { console.log(f()); } catch (e) { console.log(e.name); }
const h = (t) => t;
console.log(f());
