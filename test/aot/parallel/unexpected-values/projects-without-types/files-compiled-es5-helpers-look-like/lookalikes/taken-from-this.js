exports.__extends = function (d, b) {
    d.prototype = { speak: function () { return "the helper came from this"; } };
};
exports.__assign = function () {
    return "the helper came from this";
};
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dog = exports.Animal = void 0;
var Animal = (function () {
    function Animal(name) {
        this.name = name;
        this.legs = 4;
    }
    Animal.prototype.speak = function () {
        return this.name + " makes a sound";
    };
    Animal.count = function () {
        return "counted by " + this.name;
    };
    return Animal;
}());
exports.Animal = Animal;
var Dog = (function (_super) {
    __extends(Dog, _super);
    function Dog() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    Dog.prototype.speak = function () {
        return _super.prototype.speak.call(this) + ": woof";
    };
    return Dog;
}(Animal));
exports.Dog = Dog;
exports.withDefaults = function (options) {
    return __assign(__assign({}, { width: 1 }), options);
};
