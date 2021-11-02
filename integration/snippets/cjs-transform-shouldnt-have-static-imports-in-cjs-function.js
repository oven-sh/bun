import _login from "./_login";
import _auth from "./_auth";
import * as _loginReally from "./_login";
import * as _loginReally2 from "./_login";
import * as _authReally from "./_auth";

// module.exports.iAmCommonJs = true;
// exports.YouAreCommonJS = true;
// require("./_login");
// require("./_login");
export { _login as login };

export function test() {
  return testDone(import.meta.url);
}

export let foo, bar;
