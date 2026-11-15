"use strict";
class Base {
    static made = "made";
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}
class Below extends Base {}
module.exports = Below;
