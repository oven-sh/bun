import {
__require as require
} from "http://localhost:8080/bun:wrap";
import * as $2f488e5b from "http://localhost:8080/node_modules/react/jsx-dev-runtime.js";
var JSX = require($2f488e5b);
var jsx = require(JSX).jsxDEV;

import * as $bbcd215f from "http://localhost:8080/node_modules/react/index.js";
var { default: React} = require($bbcd215f);
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
export function test() {
  const foo = jsx(TestComponent, {}, undefined, false, undefined, this);
  return testDone(import.meta.url);
}
