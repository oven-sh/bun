import {
__HMRClient as Bun
} from "http://localhost:8080/__runtime.js";
import {
__require as require
} from "http://localhost:8080/__runtime.js";
import {
__HMRModule as HMR
} from "http://localhost:8080/__runtime.js";
import * as JSX from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var jsx = require(JSX).jsxDEV;

import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($bbcd215f);
Bun.activate(false);

var hmr = new HMR(3514348331, "react-context-value-func.tsx"), exports = hmr.exports;
(hmr._load = function() {
  const Context = React.createContext({});
  const ContextProvider = ({ children }) => {
    const [cb, setCB] = React.useState(function() {
    });
    const foo = true;
    return jsx(Context.Provider, {
      value: cb,
      children: [children(foo)]
    }, undefined, true, undefined, this);
  };
  const ContextValue = ({}) => jsx(Context.Consumer, {
    children: [(foo) => {
      if (foo)
        return jsx("div", {
          children: ["Worked!"]
        }, undefined, true, undefined, this);
      throw `Value "${foo}"" should be true`;
    }]
  }, undefined, true, undefined, this);
  const TestComponent = () => jsx(ContextProvider, {
    children: [jsx(ContextValue, {}, undefined, true, undefined, this)]
  }, undefined, true, undefined, this);
  function test() {
    const foo = jsx(TestComponent, {}, undefined, true, undefined, this);
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
