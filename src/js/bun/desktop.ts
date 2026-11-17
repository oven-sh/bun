const native = $bindgen("desktop_modules.bind.ts", "modules").desktop();
const render = $bindgen("render.bind.ts", "renderApi");

export default {
  ...render,
  ...native,
  Children: $bindgen("render.bind.ts", "renderChildren"),
  Component: $bindgen("render.bind.ts", "RenderComponent"),
  Fragment: Symbol.for("react.fragment"),
  PureComponent: $bindgen("render.bind.ts", "PureComponent"),
  StrictMode: Symbol.for("react.strict_mode"),
  Suspense: Symbol.for("react.suspense"),
};
