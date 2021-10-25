import {
__require as require
} from "http://localhost:8080/__runtime.js";
import {
__cJS2eSM
} from "http://localhost:8080/__runtime.js";
import * as _login_b977_0 from "http://localhost:8080/_login.js";
import * as _login_b977_1 from "http://localhost:8080/_login.js";
import _login from "http://localhost:8080/_login.js";
import _auth from "http://localhost:8080/_auth.js";
import * as _loginReally from "http://localhost:8080/_login.js";
import * as _loginReally2 from "http://localhost:8080/_login.js";
import * as _authReally from "http://localhost:8080/_auth.js";

export default __cJS2eSM(function(module, exports) {
  ;

  ;
  ;
  ;
  ;
  module.exports.iAmCommonJs = true;
  exports.YouAreCommonJS = true;
  require(_login_b977_0);
  require(_login_b977_1);
  Object.defineProperty(module.exports,"login",{get: () => _login, enumerable: true, configurable: true});
  function test() {
    return testDone(import.meta.url);
  };
var test = test;
  Object.defineProperty(module.exports,"test",{get: () => test, enumerable: true, configurable: true});
  var foo, bar;
  Object.defineProperties(module.exports,{'foo': {get: () => foo, set: ($_newValue) => {foo = $_newValue;}, enumerable: true, configurable: true},
'bar': {get: () => bar, set: ($_newValue) => {bar = $_newValue;}, enumerable: true, configurable: true}});
}, "cjs-transform-shouldnt-have-static-imports-in-cjs-function.js");



