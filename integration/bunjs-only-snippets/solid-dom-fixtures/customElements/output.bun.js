var _tmpl = _template$("<my-element/>", 0), _tmpl$2 = _template$('<my-element><header slot="head">Title</header></my-element>', 4);
const template = () => {
  var _el = _tmpl.cloneNode(true);
  setAttribute(_el, "some-attr", name);
  setAttribute(_el, "notProp", data);
  setAttribute(_el, "attr:my-attr", data);
  setAttribute(_el, "prop:someProp", data);
  return _el;
};
const template2 = () => {
  var _el = _tmpl.cloneNode(true);
  effect(() => {
    return setAttribute(_el, "some-attr", state.name);
  });
  effect(() => {
    return setAttribute(_el, "notProp", state.data);
  });
  effect(() => {
    return setAttribute(_el, "attr:my-attr", state.data);
  });
  effect(() => {
    return setAttribute(_el, "prop:someProp", state.data);
  });
  return _el;
};
const template3 = _tmpl$2.cloneNode(true);
const template4 = ;
