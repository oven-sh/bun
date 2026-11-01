var Kind;
(function (Kind) { Kind[Kind["A"] = 0] = "A"; Kind[Kind["B"] = 1] = "B"; })(Kind || (Kind = {}));
export const read = () => [Kind.A, Kind.B, Kind[0], Kind[1], Object.keys(Kind).join("/")].join();
export const whole = () => Kind;
