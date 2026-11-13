(() => {
    var bodies = {
        "./names.js": (module, exports, load) => {
            exports.show = (x) => "name " + x;
            exports.Point = class {
                constructor(x) {
                    this.x = x;
                }
            };
        },
        "./function.js": (module, exports, load) => {
            var names = load("./names.js");
            module.exports = function (x) {
                return names.show(x) + "!";
            };
            module.exports.late = () => load("./object.js").twice(4);
        },
        "./object.js": (module, exports, load) => {
            module.exports = { twice: (x) => 2 * x + typeof load("./names.js").show };
        },
        "./handed.js": (module, exports, load) => {
            function fill(target) {
                target.exports = { filled: true };
            }
            fill(module);
        },
        "./deleted.js": (module, exports, load) => {
            exports.gone = 1;
            exports.kept = 2;
            delete exports.gone;
        },
        "./inside.js": (module, exports, load) => {
            var object = { p: 1 };
            with (object) {
                p = 2;
            }
            exports.p = object.p;
        },
        "./main.js": (module, exports, load) => {
            var whole = load("./function.js"), names = load("./names.js");
            exports.run = (n) => [
                whole(n),
                whole.late(),
                new names.Point(n).x,
                JSON.stringify(load("./handed.js")),
                JSON.stringify(load("./deleted.js")),
                load("./inside.js").p,
            ].join();
        },
    };
    var cache = {};
    function load(id) {
        var cached = cache[id];
        if (cached !== undefined)
            return cached.exports;
        var module = cache[id] = { exports: {} };
        bodies[id](module, module.exports, load);
        return module.exports;
    }
    console.log(load("./main.js").run(3));
    console.log(load("./main.js").run("x"));
})();

(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var list = require("./list");
console.log(list.join([1, 2]), list(3), Object.keys(list).join());
},{"./list":2}],2:[function(require,module,exports){
var text = require("./text");
module.exports = function (x) { return text.quote(x); };
module.exports.join = function (xs) { return xs.map(text.quote).join(); };
},{"./text":3}],3:[function(require,module,exports){
exports.quote = function (x) { return "'" + x + "'"; };
},{}]},{},[1]);

var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_first = __commonJS({ "first.js"(exports) { exports.f = (x) => "first " + x; } });
var require_second = __commonJS({ "second.js"(exports, module) { var first = require_first(); module.exports = { g: (x) => first.f(x) + " second" }; } });
console.log(require_second().g(1), require_second() === require_second());

function look(object) {
    with (object) {
        return x;
    }
}
console.log(look({ x: 1 }));
