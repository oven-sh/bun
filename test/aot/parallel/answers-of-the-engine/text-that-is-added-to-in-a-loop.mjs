// A text that is added to again and again moves into a buffer with room, and what is added is written behind it: AOTGrowingText.h. Each way in which that could show: the lengths around the first buffer, one, two and three pieces at a time, pieces that are long, empty or 16-bit, texts that are kept while the text grows on and are added to later, two texts in turn, a text added to itself, the end of a text, reads in the loop.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function sumOf(text) { let sum = 0; for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; return sum; }
function oneCharacter(count) { let text = ""; for (let i = 0; i < count; i++) text += "x"; return text; }
function threePieces(count) { let text = ""; for (let i = 0; i < count; i++) text += "k" + i + ","; return text; }
function template(count) { let text = ""; for (let i = 0; i < count; i++) text = `${text}<${i}>`; return text; }
function longPieces(count) { let text = ""; for (let i = 0; i < count; i++) text += "0123456789abcdefghijklmnopqrstuvwxyz"; return text; }
function emptyPieces(count) { let text = ""; let nothing = ""; for (let i = 0; i < count; i++) text += (i & 1 ? nothing : "ab") + nothing; return text; }
function widePieceInTheMiddle(count) { let text = ""; for (let i = 0; i < count; i++) text += i === 700 ? "€" : "y"; return text; }
function readInTheLoop(count) { let text = ""; let wrong = 0; for (let i = 0; i < count; i++) { text += "ab,"; if (text.charCodeAt(text.length - 1) !== 44) wrong++; } return wrong * 1000000 + text.length; }
function olderTexts(count) { let text = ""; let older = ""; let oldest = ""; for (let i = 0; i < count; i++) { text += "p" + i; if (i === 200) oldest = text; if (i === 900) older = text; } const other = older + "!"; const another = older + "?"; const third = oldest + "#" + "$"; return sumOf(text) ^ sumOf(older) ^ sumOf(oldest) ^ sumOf(other) ^ sumOf(another) ^ sumOf(third); }
function twoTextsInTurn(count) { let a = ""; let b = ""; for (let i = 0; i < count; i++) { a += "a" + i; b += "b" + i; } return sumOf(a) ^ (sumOf(b) * 3); }
function addedToItself(count) { let text = oneCharacter(count); text += text; text += "z"; text += text; return text; }
function endOfText(count) { const text = threePieces(count); let end = text.slice(300); end += "tail"; let whole = text + "head"; return sumOf(end) ^ sumOf(whole) ^ sumOf(text); }
function inFrontOfText(count) { let text = ""; for (let i = 0; i < count; i++) text = "x" + i + text; return text; }
function numbers(count) { let text = ""; for (let i = 0; i < count; i++) text += i; for (let i = 0; i < count; i++) text += i + 0.5; for (let i = 0; i < 300; i++) text += i % 3 === 0 ? null : i % 3 === 1 ? undefined : true; return text; }
report(oneCharacter(255).length);
report(sumOf(oneCharacter(256)));
report(sumOf(oneCharacter(257)));
report(sumOf(oneCharacter(258)));
report(sumOf(oneCharacter(259)));
report(sumOf(oneCharacter(5000)));
report(sumOf(threePieces(3000)));
report(threePieces(3000).length);
report(sumOf(template(2000)));
report(sumOf(longPieces(500)));
report(sumOf(emptyPieces(2000)));
report(sumOf(widePieceInTheMiddle(2000)));
report(widePieceInTheMiddle(2000).charCodeAt(700));
report(readInTheLoop(2000));
report(olderTexts(2000));
report(twoTextsInTurn(1500));
report(sumOf(addedToItself(600)));
report(endOfText(1000));
report(sumOf(inFrontOfText(1000)));
report(sumOf(numbers(1200)));
report(threePieces(400).indexOf("k399,"));
report(threePieces(400) === threePieces(400));
report(threePieces(400) + "a" < threePieces(400) + "b");
report("end");
