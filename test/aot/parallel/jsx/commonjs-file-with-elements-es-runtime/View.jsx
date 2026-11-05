/** @jsxImportSource ./mini */
console.log("view starts");
const { next } = require("./counter.js");
const early = (
  <p>
    {"early"}
    {next()}
  </p>
);
console.log(early);
function View(props) {
  return (
    <p>
      {early}
      {props.a}
      <b>{next()}</b>
    </p>
  );
}
module.exports = { View };
