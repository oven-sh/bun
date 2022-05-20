var _tmpl$1 = template("<span>Hello </span>", 2), _tmpl$2 = template("<span> John</span>", 2), _tmpl$3 = template("<span>Hello   John</span>", 2), _tmpl$3 = template("<span> </span>", 4), _tmpl$4 = template("<span>   </span>", 4), _tmpl$5 = template("<span>  </span>", 4), _tmpl$7 = template("<span>Hello</span>", 2), _tmpl$8 = template("<span>Hello John</span>", 2), _tmpl$9 = template("<span> &lt;Hi&gt; </span>", 2), _tmpl$10 = template("<span>Hi&lt;script&gt;alert();&lt;/script&gt;</span>", 2), _tmpl$10 = template("<span>4 + 5 = </span>", 3), _tmpl$11 = template("<div>\nd</div>", 3), _tmpl$12 = template("<div</div>", 2);
const trailing = _tmpl$1.cloneNode(true);
const leading = _tmpl$2.cloneNode(true);
const extraSpaces = _tmpl$3.cloneNode(true);
const trailingExpr = () => {
  var _tmpl$1 = _tmpl$1.cloneNode(true);
  insert(_tmpl$1, name, null);
  return _tmpl$1;
};
const leadingExpr = () => {
  var _tmpl$2 = _tmpl$2.cloneNode(true);
  insert(_tmpl$2, greeting, null);
  return _tmpl$2;
};
const multiExpr = () => {
  var _tmpl$3 = _tmpl$3.cloneNode(true);
  insert(_tmpl$3, greeting, null);
  insert(_tmpl$3, name, null);
  return _tmpl$3;
};
const multiExprSpaced = () => {
  var _tmpl$4 = _tmpl$4.cloneNode(true);
  insert(_tmpl$4, greeting, null);
  insert(_tmpl$4, name, null);
  return _tmpl$4;
};
const multiExprTogether = () => {
  var _tmpl$5 = _tmpl$5.cloneNode(true);
  insert(_tmpl$5, greeting, null);
  insert(_tmpl$5, name, null);
  return _tmpl$5;
};
const multiLine = _tmpl$7.cloneNode(true);
const multiLineTrailingSpace = _tmpl$8.cloneNode(true);
const multiLineNoTrailingSpace = _tmpl$8.cloneNode(true);
const escape = _tmpl$9.cloneNode(true);
const escape2 = createComponent(Comp, {
  get children: [
    "\xA0<Hi>\xA0"
  ]
});
const escape3 = ;
const injection = _tmpl$10.cloneNode(true);
let value = "World";
const evaluated = () => {
  var _tmpl$1 = _tmpl$1.cloneNode(true);
  insert(_tmpl$1, value + "!", null);
  return _tmpl$1;
};
let number = 4 + 5;
const evaluatedNonString = () => {
  var _tmpl$10 = _tmpl$10.cloneNode(true);
  insert(_tmpl$10, number, null);
  return _tmpl$10;
};
const newLineLiteral = () => {
  var _tmpl$11 = _tmpl$11.cloneNode(true);
  insert(_tmpl$11, s, null);
  return _tmpl$11;
};
const trailingSpace = () => {
  var _tmpl$12 = _tmpl$12.cloneNode(true);
  insert(_tmpl$12, expr, null);
  return _tmpl$12;
};
const trailingSpaceComp = createComponent(Comp, {
  get children: [
    expr
  ]
});
const trailingSpaceFrag = ;
