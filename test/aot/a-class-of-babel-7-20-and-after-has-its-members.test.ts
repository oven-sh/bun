import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

// The helpers as published packages hold them.
const helpers: Record<string, string> = {
  "babel 7.20 to 7.22":
    'function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }\nfunction _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }\nfunction _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }\nfunction _toPrimitive(input, hint) { if (typeof input !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (typeof res !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }\n',
  "babel 7.23 and after":
    'function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }\nfunction _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }\nfunction _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }\nfunction _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }\n',
  "babel 7.23 and after, typeof transformed":
    'function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }\nfunction _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }\nfunction _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }\nfunction _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }\nfunction _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }\n',
  "@babel/runtime 7.29":
    'function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }\nfunction _toPrimitive(t, e) { if ("object" != _typeof(t) || !t) return t; var r; if ("undefined" != typeof Symbol && void 0 !== (r = t[Symbol.toPrimitive])) { var i = r.call(t, e || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === e ? String : Number)(t); }\nfunction _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }\nfunction _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }\nfunction _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }\n',
};

const program = `var Animal = /*#__PURE__*/function () {
  function Animal(name) {
    this._name = name;
  }
  return _createClass(Animal, [{
    key: "speak",
    value: function speak() {
      return this.name + " makes a sound";
    }
  }, {
    key: "name",
    get: function get() {
      return this._name;
    },
    set: function set(name) {
      this._name = name;
    }
  }], [{
    key: "of",
    value: function of(name) {
      return new Animal(name);
    }
  }]);
}();
function turn(name) {
  var animal = Animal.of(name);
  animal.name = animal.name + "!";
  return animal.speak();
}
console.log(turn("Rex"), Object.getOwnPropertyNames(Animal.prototype).join(), Object.keys(Animal.prototype).length, Object.getOwnPropertyDescriptor(Animal, "prototype").writable);
`;

for (const [origin, text] of Object.entries(helpers)) {
  test(`a class that ${origin} wrote has its members where the class is made`, async () => {
    using dir = tempDir("aot-create-class-of-later-babel", { "main.js": '"use strict";\n' + text + program });
    const folder = String(dir);
    const env = { ...bunEnv, NO_COLOR: "1" };
    const command = [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      writesProgramInto(folder),
      "main.js",
      "--outfile",
      "main",
    ];
    built(await spawned(command, folder, env));
    const ran = await spawned(["./main"], folder, env);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
      stdout: "Rex! makes a sound constructor,speak,name 0 false\n",
      exitCode: 0,
    });

    const turn = await printIR(folder, { until: "Select", functionName: "turn" });
    const likely = turn
      .split(/^(?=  b\d+\()/m)
      .filter(block => /^  b\d+\(.*\):$/m.test(block.split("\n")[0]!))
      .join("");
    const byName = likely
      .split("\n")
      .filter(line => /key="(speak|name)"/.test(line) && /PropGet|PropSet|CallMethod/.test(line));
    expect(byName).toEqual([]);
  }, 120_000);
}
