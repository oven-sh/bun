var log = [];
var __extends = function (d, b) {
    log.push("extends " + d.name + " " + (b && b.name));
    d.prototype.speak = function () {
        return "a look-alike linked nothing";
    };
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
exports.log = log;
