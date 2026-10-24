// Classic JSX runtime without a pragma: `React.createElement` is called as a method, with `this` being `React`.
/** @jsxRuntime classic */
const React = { createElement(t, p) { return [typeof t, this === React].join(" | "); } };
console.log(React.createElement(1, null));
console.log(<a />); console.log((() => <a />)());
