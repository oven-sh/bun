import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:3000/bun:wrap";
import {
__require as require
} from "http://localhost:3000/bun:wrap";
import {
__HMRClient as Bun
} from "http://localhost:3000/bun:wrap";
import {
__FastRefreshModule as FastHMR
} from "http://localhost:3000/bun:wrap";
import * as $2f488e5b from "http://localhost:3000/node_modules/react/jsx-dev-runtime.js";
var JSX = require($2f488e5b);
var jsx = require(JSX).jsxDEV;

import * as $bbcd215f from "http://localhost:3000/node_modules/react/index.js";
var { default: React} = require($bbcd215f);
Bun.activate(true);

var hmr = new FastHMR(3514348331, "react-context-value-func.tsx", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  const Context = React.createContext({});
  const ContextProvider = ({ children }) => {
    const [cb, setCB] = React.useState(function() {
    });
    const foo = true;
    return jsx(Context.Provider, {
      value: cb,
      children: children(foo)
    }, undefined, false, undefined, this);
  };
  const ContextValue = ({}) => jsx(Context.Consumer, {
    children: (foo) => {
      if (foo)
        return jsx("div", {
          children: "Worked!"
        }, undefined, false, undefined, this);
      throw `Value "${foo}"" should be true`;
    }
  }, undefined, false, undefined, this);
  const TestComponent = () => jsx(ContextProvider, {
    children: jsx(ContextValue, {}, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
  function test() {
    const foo = jsx(TestComponent, {}, undefined, false, undefined, this);
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    test: () => test
  });
})();
var $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_test = exports.test;
};

export {
  $$hmr_test as test
};

//# sourceMappingURL=http://localhost:3000/react-context-value-func.tsx.map
