// A text grows in a loop and in a short loop inside it. Each function varies what the inner turns append (the same kind in every turn, another kind in each), who reads the text on the way, and how the loops are left.
const said: string[] = [];
const words = ["alpha", "beta", "gamma", "delta"];
const mixed: unknown[] = [1, "two", null, undefined, true, 2.5, -0, 7n];
const speaks = (name: string) => ({ toString() { said.push(name + " is asked"); return name; } });
const talkers: unknown[] = ["plain", speaks("second"), 3, speaks("fourth")];
const forms: Record<string, (n: number) => string> = {
  bothLoops(n) { let s = ""; for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 3; j++) s += words[j]; } return s; },
  theInnerAlone(n) { let s = ""; for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) s += words[j]; return s; },
  anotherKindInEachTurn(n) { let s = ""; for (let i = 0; i < n; i++) { s += "|"; for (let j = 0; j < 8; j++) s += mixed[j]; } return s; },
  theSecondTurnAloneIsNoText(n) { let s = ""; for (let i = 0; i < n; i++) { s += "|"; for (let j = 0; j < 4; j++) s += talkers[j]; } return s; },
  numbersAloneInside(n) { let s = ""; for (let i = 0; i < n; i++) { s += ":"; for (let j = 0; j < 3; j++) s += j * i; } return s; },
  theFirstTurnAppendsNothing(n) { let s = ""; for (let i = 0; i < n; i++) { s += "("; for (let j = 0; j < 3; j++) { if (j) s += words[j]; } } return s; },
  theLengthIsReadInside(n) { let s = ""; for (let i = 0; i < n; i++) { s += "<"; for (let j = 0; j < 3; j++) s += s.length + words[j]; } return s; },
  theTextIsKeptInside(n) { let s = "", kept = ""; for (let i = 0; i < n; i++) { s += "<"; for (let j = 0; j < 3; j++) { s += words[j]; if (j === 1) kept = s; } } return s + "/" + kept; },
  theTextIsComparedInside(n) { let s = "", hits = 0; for (let i = 0; i < n; i++) { s += "a"; for (let j = 0; j < 3; j++) { if (s === "aalpha") hits++; s += words[j]; } } return s.length + "/" + hits; },
  aBreakOutOfTheInner(n) { let s = ""; for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 4; j++) { if (j === (i & 3)) break; s += words[j]; } } return s; },
  aBreakOutOfBoth(n) { let s = ""; outer: for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 3; j++) { if (i === 5 && j === 1) break outer; s += words[j]; } } return s; },
  aContinueOfTheOuter(n) { let s = ""; outer: for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 3; j++) { if (j === 2 && (i & 1)) continue outer; s += words[j]; } s += "]"; } return s; },
  twoInnerLoops(n) { let s = ""; for (let i = 0; i < n; i++) { for (let j = 0; j < 2; j++) s += words[j]; s += "-"; for (let j = 2; j < 4; j++) s += mixed[j]; } return s; },
  threeLevels(n) { let s = ""; for (let i = 0; i < n; i++) { s += "{"; for (let j = 0; j < 2; j++) { s += "["; for (let k = 0; k < 2; k++) s += words[j + k]; } } return s; },
  theInnerTurnsHangOnTheOuter(n) { let s = ""; for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < (i & 3); j++) s += words[j]; } return s; },
  theTextBecomesANumberInside(n) { let s: any = ""; for (let i = 0; i < n; i++) { s += "1"; for (let j = 0; j < 2; j++) { if (i === 3 && j === 1) s = s * 1; s += j; } } return String(s); },
  aThrowInside(n) { let s = ""; try { for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 3; j++) { if (i === 4 && j === 2) throw new RangeError("at " + s.length); s += words[j]; } } } catch (error) { return s + "!" + (error as Error).message; } return s; },
  twoTexts(n) { let s = "", t = ""; for (let i = 0; i < n; i++) { s += "["; for (let j = 0; j < 3; j++) { s += words[j]; t += j; } t += s.length; } return s + "/" + t; },
};
for (const [name, form] of Object.entries(forms)) for (const turns of [0, 1, 2, 9]) { const text = form(turns); said.push(name + " " + turns + " " + (text.length > 90 ? text.length + ":" + text.slice(0, 40) + ".." + text.slice(-40) : text)); }
let length = 0;
for (let round = 0; round < 3000; round++) for (const form of Object.values(forms)) length += form(12).length;
said.length = Math.min(said.length, 400);
said.push(String(length));
console.log(said.join("\n"));
