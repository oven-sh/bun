// Two array literals meet in one value, and find() is left in its first turn: the position of the read is one known integer that is no constant of the text.
const show = value => JSON.stringify(value, (key, each) => (each === undefined ? "undefined" : each));
function integersOrTexts(which) { return (which === 0 ? [5, 6, 7] : ["a", "b"]).find(each => each !== 1); }
function integersOfTwoLengths(which) { return (which === 0 ? [5, 6, 7] : [8, 9]).find(each => each !== 1); }
function integersOfOneLength(which) { return (which === 0 ? [5, 6] : [8, 9]).find(each => each !== 1); }
function fractionOrTexts(which) { return (which === 0 ? [1.5] : ["c", "d", "e"]).find(each => each !== 1); }
function fractionsOfTwoLengths(which) { return (which === 0 ? [1.5, 2.5, 3.5] : [4.5]).find(each => each !== 1); }
function integersOrNothing(which) { return (which === 0 ? [8, 9] : []).find(each => each !== 1); }
function nothingOrTexts(which) { return (which === 0 ? [] : ["c", "d", "e"]).find(each => each !== 1); }
function objects(which) { return (which === 0 ? [{ p: 1 }, { p: 2 }] : [{ p: 3 }]).find(each => each !== 1); }
function oneOfThree(which) { return (which === 0 ? [5, 6, 7] : which === 1 ? ["a", "b"] : [1.5]).find(each => each !== 1); }
function oneOfThreeOrNothing(which) { return (which === 0 ? [] : which === 1 ? [8, 9] : ["c", "d", "e"]).find(each => each !== 1); }
for (const ask of [integersOrTexts, integersOfTwoLengths, integersOfOneLength, fractionOrTexts, fractionsOfTwoLengths, integersOrNothing, nothingOrTexts, objects, oneOfThree, oneOfThreeOrNothing])
  console.log(ask.name, show([ask(0), ask(1), ask(2)]));
