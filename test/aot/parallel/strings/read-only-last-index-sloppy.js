// A CommonJS file is sloppy: a store to a read-only lastIndex does nothing and does not throw.
function readOnly(re) {
  Object.defineProperty(re, "lastIndex", { writable: false });
  return re;
}
function attempt(store) {
  try {
    return String(store());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "other error";
  }
}

function storeToLiteral() {
  const re = /a/g;
  Object.defineProperty(re, "lastIndex", { writable: false });
  re.lastIndex = 1;
  return re.lastIndex;
}
function storeToWritableLiteral() {
  const re = /a/g;
  re.lastIndex = 1;
  return re.lastIndex;
}
function storeToParameter(receiver, value) {
  receiver.lastIndex = value;
  return receiver.lastIndex;
}
// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict store.
class StrictCode {
  static storeToLiteralStrict = function () {
    const re = /a/g;
    Object.defineProperty(re, "lastIndex", { writable: false });
    re.lastIndex = 1;
    return re.lastIndex;
  };
  static storeToParameterStrict = function (receiver, value) {
    receiver.lastIndex = value;
    return receiver.lastIndex;
  };
}
const { storeToLiteralStrict, storeToParameterStrict } = StrictCode;

console.log("literal:", attempt(storeToLiteral));
console.log("writable literal:", attempt(storeToWritableLiteral));
console.log("literal, strict:", attempt(storeToLiteralStrict));
for (const store of [storeToParameter, storeToParameterStrict]) {
  console.log(store.name);
  console.log("  read-only:", attempt(() => store(readOnly(/a/g), 1)));
  console.log("  read-only, an object stored:", attempt(() => typeof store(readOnly(/a/y), {})));
  console.log("  writable:", attempt(() => store(/a/g, 1)));
  console.log("  frozen object:", attempt(() => store(Object.freeze({ lastIndex: 5 }), 1)));
  console.log("  ordinary object:", attempt(() => store({}, 1)));
  console.log("  number:", attempt(() => store(7, 1)));
}

const sticky = readOnly(/a/y);
sticky.lastIndex = 2;
console.log("exec after an ignored store:", attempt(() => sticky.exec("aaa").index), sticky.lastIndex);

module.exports = { storeToParameter, storeToParameterStrict };
