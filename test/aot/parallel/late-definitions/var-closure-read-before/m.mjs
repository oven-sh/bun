export const peek = () => typeof f;
export const early = peek();
var f = function () { return 1; };
export const read = () => f;
