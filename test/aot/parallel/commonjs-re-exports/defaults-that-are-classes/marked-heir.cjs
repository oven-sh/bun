class Base { static get default() { return "of " + (this === Base ? "Base" : "a heir"); } }
class Heir extends Base {}
Heir.__esModule = true;
module.exports = Heir;
