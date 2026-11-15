"use strict";
function define(type, props, base) {
  props = props ? props.split(/\s+/) : [];
  if (base && base.PROPS) props = props.concat(base.PROPS);
  var code = ["return function ", type, "(props){"];
  props.forEach(function (prop) {
    code.push("this.", prop, "=props.", prop, ";");
  });
  code.push("};");
  var ctor = new Function(code.join(""))();
  ctor.PROPS = props;
  return (exports[type] = ctor);
}
var Leaf = define("Leaf", "value start", null);
var Pair = define("Pair", "left right", Leaf);
