var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) =>
  function __init() {
    return (fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res);
  };
var Color;
var init_color = __esm({
  "color.ts"() {
    Color = /* @__PURE__ */ (Color2 => {
      Color2[(Color2["Red"] = 0)] = "Red";
      Color2[(Color2["Green"] = 5)] = "Green";
      return Color2;
    })(Color || {});
  },
});
init_color();
console.log(Color.Green);
Color.Green = 9;
console.log(Color.Green);
