// Two lookup functions as a generator writes them: one chain of `if .. else if ..`, a `return` in each arm, no braces. So the file has
// more `return` statements than its lists of statements and arguments have entries, and the helper of TypeScript stands behind them.

function grade(n) {
  if (n < 10) return 0; else if (n < 20) return 1; else if (n < 30) return 2; else if (n < 40) return 3; else if (n < 50) return 4;
  else if (n < 60) return 5; else if (n < 70) return 6; else if (n < 80) return 7; else if (n < 90) return 8; else if (n < 100) return 9;
  else if (n < 110) return 10; else if (n < 120) return 11; else if (n < 130) return 12; else if (n < 140) return 13; else if (n < 150) return 14;
  else if (n < 160) return 15; else if (n < 170) return 16; else if (n < 180) return 17; else if (n < 190) return 18; else if (n < 200) return 19;
  else if (n < 210) return 20; else if (n < 220) return 21; else if (n < 230) return 22; else if (n < 240) return 23; else if (n < 250) return 24;
  else if (n < 260) return 25; else if (n < 270) return 26; else if (n < 280) return 27; else if (n < 290) return 28; else if (n < 300) return 29;
  else if (n < 310) return 30; else if (n < 320) return 31; else if (n < 330) return 32; else if (n < 340) return 33; else if (n < 350) return 34;
  else if (n < 360) return 35; else if (n < 370) return 36; else if (n < 380) return 37; else if (n < 390) return 38; else if (n < 400) return 39;
  else if (n < 410) return 40; else if (n < 420) return 41; else if (n < 430) return 42; else if (n < 440) return 43; else if (n < 450) return 44;
  else if (n < 460) return 45; else if (n < 470) return 46; else if (n < 480) return 47; else if (n < 490) return 48; else if (n < 500) return 49;
  else if (n < 510) return 50; else if (n < 520) return 51; else if (n < 530) return 52; else if (n < 540) return 53; else if (n < 550) return 54;
  else if (n < 560) return 55; else if (n < 570) return 56; else if (n < 580) return 57; else if (n < 590) return 58; else if (n < 600) return 59;
  else return -1;
}

function band(n) {
  if (n < 10) return 1; else if (n < 20) return 2; else if (n < 30) return 3; else if (n < 40) return 4; else if (n < 50) return 5;
  else if (n < 60) return 6; else if (n < 70) return 7; else if (n < 80) return 8; else if (n < 90) return 9; else if (n < 100) return 10;
  else if (n < 110) return 11; else if (n < 120) return 12; else if (n < 130) return 13; else if (n < 140) return 14; else if (n < 150) return 15;
  else if (n < 160) return 16; else if (n < 170) return 17; else if (n < 180) return 18; else if (n < 190) return 19; else if (n < 200) return 20;
  else if (n < 210) return 21; else if (n < 220) return 22; else if (n < 230) return 23; else if (n < 240) return 24; else if (n < 250) return 25;
  else if (n < 260) return 26; else if (n < 270) return 27; else if (n < 280) return 28; else if (n < 290) return 29; else if (n < 300) return 30;
  else if (n < 310) return 31; else if (n < 320) return 32; else if (n < 330) return 33; else if (n < 340) return 34; else if (n < 350) return 35;
  else if (n < 360) return 36; else if (n < 370) return 37; else if (n < 380) return 38; else if (n < 390) return 39; else if (n < 400) return 40;
  else if (n < 410) return 41; else if (n < 420) return 42; else if (n < 430) return 43; else if (n < 440) return 44; else if (n < 450) return 45;
  else if (n < 460) return 46; else if (n < 470) return 47; else if (n < 480) return 48; else if (n < 490) return 49; else if (n < 500) return 50;
  else if (n < 510) return 51; else if (n < 520) return 52; else if (n < 530) return 53; else if (n < 540) return 54; else if (n < 550) return 55;
  else if (n < 560) return 56; else if (n < 570) return 57; else if (n < 580) return 58; else if (n < 590) return 59; else if (n < 600) return 60;
  else return -1;
}

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

var Animal = (function () {
    function Animal(name) {
        this.name = name;
    }
    Animal.prototype.speak = function () {
        return this.name + " makes a sound";
    };
    return Animal;
}());

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

console.log(new Dog("Rex").speak(), new Dog("Rex") instanceof Animal);
console.log(grade(5), grade(305), grade(1000), band(5), band(305), band(1000));
