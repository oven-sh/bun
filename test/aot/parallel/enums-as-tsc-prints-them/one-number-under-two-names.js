// Two members with one number: the later name lies under the number, at the place of the first.
var Levels;
(function (Levels) {
    Levels[Levels["Low"] = -2] = "Low";
    Levels[Levels["Middle"] = 3] = "Middle";
    Levels[Levels["Least"] = -2] = "Least";
    Levels[Levels["Center"] = 3] = "Center";
    Levels[Levels["High"] = 9] = "High";
})(Levels || (Levels = {}));
console.log(Object.keys(Levels).join(), Levels[-2], Levels[3], Levels.Low === Levels.Least);
console.log(JSON.stringify(Levels));
