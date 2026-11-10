// STATISTIC: ReceiversReadOffVariablesToldApartInFrontOfLoops >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const parsed = JSON.parse('{"numbers":[1.5,2,3.25,4],"texts":["a","b","c","d"]}');
function sum(turns) { let s = 0, turn = -1; try { for (let i = 0; i < turns; i++) { turn = i; s += table[i] * 2; } } catch (error) { return error.constructor.name + " in turn " + turn; } finally { s += 100; } return s; }
function sumOfNothing(turns) { let s = 0; try { for (let i = 0; i < turns; i++) s += nothing[i] * 2; } catch (error) { return error.constructor.name; } return s; }
const early = [unseen(sum)(0), unseen(sum)(3)];
const table = parsed.numbers;
let nothing = unseen(null);
console.log(early.join(" | "), unseen(sum)(0), unseen(sum)(4), unseen(sum)(6), unseen(sumOfNothing)(0), unseen(sumOfNothing)(2));
nothing = unseen(undefined); console.log(unseen(sumOfNothing)(0), unseen(sumOfNothing)(2)); nothing = parsed.texts; console.log(unseen(sumOfNothing)(2)); nothing = parsed.numbers; console.log(unseen(sumOfNothing)(4));
