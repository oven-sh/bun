/** @jsxRuntime classic */
/** @jsx h */
function h(tag, props) { return typeof tag === "function" ? tag(props ?? {}) : tag; }
const ui = { Button(props) { return "button " + props.label; }, Unused() { return "unused"; } };
class Widgets { static Panel() { return "panel"; } }
console.log(<ui.Button label="ok" />, <Widgets.Panel />);
