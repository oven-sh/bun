// Classic JSX runtime: an element is created while the factory is still in its temporal dead zone.
/** @jsxRuntime classic */ /** @jsx h */
const f = () => <a />;
try { console.log(f()); } catch (e) { console.log(e.name); }
const h = (t) => t;
console.log(f());
