var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_library = __commonJS(function (exports, module) {
  function describe() {
    return this.name;
  }
  module.exports = {
    used() {
      return describe.call({ name: "used" });
    },
    unread() {
      function Item(name) {
        this.name = name;
      }
      Item.prototype.toString = function () {
        return describe.call(this);
      };
      return new Item("unread");
    },
  };
});
function valueOfThis() {
  return this.value;
}
function passOn(value) {
  return value;
}
function withPureCall() {
  /* @__PURE__ */ (function () {
    function Pure() {
      this.value = 1;
    }
    Pure.prototype.read = function () {
      valueOfThis.call(this);
    };
  })();
  return valueOfThis.call({ value: 2 });
}
function sizeOfThis() {
  return this.size;
}
var Unused = class {
  make() {
    function Part() {
      this.size = 1;
    }
    Part.prototype.read = function () {
      return sizeOfThis.call(this);
    };
    Part = passOn(Part);
    return new Part();
  }
};
export const answers = [require_library().used(), withPureCall(), sizeOfThis.call({ size: 3 }), passOn(4)];
