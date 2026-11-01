const calls = [];
function f(name) { calls.push(name); return { name }; }
class C { constructor(name) { calls.push(name); } }
function run() {
  /* @__PURE__ */ f("block comment");
  // @__PURE__
  f("line comment");
  // #__PURE__
  f("line comment with #");
  //@__PURE__
  f("line comment without a space");
  // @__PURE__ it only allocates
  f("line comment, text after");
  // @__PURE__
  // note
  f("line comment, then another line comment");
  /* @__PURE__ */ /* note */ f("block comment, then another block comment");
  /* @__PURE__ */ // note
  f("block comment, then a line comment");
  /* note */ /* @__PURE__ */ /* note */ new C("block comment between two others");
  /** @__PURE__ */ f("documentation comment");
  /**
   * @__PURE__
   */
  f("documentation comment on several lines");
  /*! @__PURE__ */ f("legal comment");
  /* @__PURE__ it only allocates */ f("block comment, text after");
  /* it only allocates: @__PURE__ */ f("block comment, text before");
  /* @__PURE__: it only allocates */ f("block comment, colon after");
  /* x@__PURE__ */ f("block comment, letter before the sign");
  /* @@__PURE__ */ f("block comment, two signs");
  /* @__NO_SIDE_EFFECTS__ @__PURE__ */ f("block comment, after another annotation");
  /** @__PURE__ */ (f("documentation comment before a parenthesis"));

  /* @__PURE__x */ f("kept: letter after");
  /* @__PURE__$ */ f("kept: dollar after");
  /* @__pure__ */ f("kept: lowercase");
  /* @ __PURE__ */ f("kept: space after the sign");
  /* __PURE__ */ f("kept: no sign");
  // note @__PURE__
  f("kept: line comment, text before");
  // # @__PURE__
  f("kept: line comment, second sign");
  /// @__PURE__
  f("kept: three slashes");
  /** @__PURE__ */ calls; /* note */ f("kept: the annotation is before another statement");
  return [/** @__PURE__ */ f("kept: the result is used")].length;
}
run();
console.log(calls.join("\n"));
