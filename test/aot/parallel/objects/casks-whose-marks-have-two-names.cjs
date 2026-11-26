// Marks of casks are symbols. Some of them have two names, and other symbols are made between them.
const chalk = [];
const markOak = Symbol("oak");
chalk.push(Symbol("a"), Symbol("b"), Symbol("c"), Symbol("d"));
const markElm = Symbol("elm");
const markAsh = Symbol("ash");
const markFir = Symbol("fir");
const markYew = Symbol("yew");
const markOld = markElm;
const markBay = Symbol("bay");
const markBox = Symbol("box");
const markFig = Symbol("fig");
function tellByTests(cask) {
    if (cask.mark === markOak) return "oak";
    if (cask.mark === markElm) return "elm";
    if (cask.mark === markAsh) return "ash";
    if (cask.mark === markFir) return "fir";
    if (cask.mark === markYew) return "yew";
    if (cask.mark === markOld) return "old";
    if (cask.mark === markBay) return "bay";
    if (cask.mark === markBox) return "box";
    if (cask.mark === markFig) return "fig";
    return "none";
}

const sealOne = Symbol.for("cask one");
chalk.push(Symbol("e"), Symbol("f"));
const sealTwo = Symbol.for("cask two");
const sealSix = Symbol.for("cask six");
const sealTwoAgain = Symbol.for("cask two");
const sealTen = Symbol.for("cask ten");
const sealRed = Symbol.for("cask red");
const sealWax = Symbol.for("cask wax");
const sealTin = Symbol.for("cask tin");
function tellBySwitch(seal) {
    switch (seal) {
        case sealOne: return 1;
        case sealTwo: return 2;
        case sealSix: return 6;
        case sealTwoAgain: return 22;
        case sealTen: return 10;
        case sealRed: return 100;
        case sealWax: return 200;
        case sealTin: return 300;
    }
    return -1;
}

const tapA = Symbol("tap a");
const tapB = Symbol("tap b");
const tapC = Symbol("tap c");
const tapD = Symbol("tap d");
const tapE = Symbol("tap e");
const tapF = Symbol("tap f");
const tapG = Symbol("tap g");
const tapH = Symbol("tap h");
const tapI = Symbol("tap i");
function tellTap(tap) {
    switch (tap) {
        case tapA: return "a";
        case tapB: return "b";
        case tapC: return "c";
        case tapD: return "d";
        case tapE: return "e";
        case tapF: return "f";
        case tapG: return "g";
        case tapH: return "h";
        case tapI: return "i";
        default: return "?";
    }
}

const marks = [markOak, markElm, markAsh, markFir, markYew, markOld, markBay, markBox, markFig, null, "elm", chalk[1], undefined];
const seals = [sealOne, sealTwo, sealSix, sealTwoAgain, sealTen, sealRed, sealWax, sealTin, Symbol.for("cask red"), chalk[4], 2, "cask two"];
const taps = [tapA, tapB, tapC, tapD, tapE, tapF, tapG, tapH, tapI, markOak, sealTwo, chalk[0], 0];
for (let turn = 0; turn < 40; turn++) {
    const told = [marks.map(mark => tellByTests({ turn, mark })).join(" "), seals.map(tellBySwitch).join(" "), taps.map(tellTap).join(" ")];
    if (turn < 2 || turn > 37)
        console.log(turn, told.join(" | "));
}
let sum = 0;
for (let turn = 0; turn < 2000; turn++)
    sum += tellBySwitch(seals[turn % seals.length]) + tellTap(taps[turn % taps.length]).length;
console.log(sum);
