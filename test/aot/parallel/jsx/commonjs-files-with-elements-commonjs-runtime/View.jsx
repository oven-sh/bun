/** @jsxImportSource ./mini */
console.log("view starts");
const { next } = require("./counter.js");
const Item = props => <li>{props.n}</li>;
exports.View = props => (
  <>
    <ul>
      <Item n={props.a} />
      <Item n={next()} key="last" />
    </ul>
    <i>{props.a}</i>
  </>
);
