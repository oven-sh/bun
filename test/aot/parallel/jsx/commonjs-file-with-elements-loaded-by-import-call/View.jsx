/** @jsxImportSource ./mini */
console.log("view starts", typeof module);
const { next } = require("./counter.js");
module = module;
exports = module.exports;
exports.View = props => (
  <p>
    {props.a}
    {next()}
  </p>
);
