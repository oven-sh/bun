function element(text: string, at: number): string | undefined { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at >= 0 && at < text.length ? text[at] : undefined; }
function below(text: string, at: number): string | undefined { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at < text.length ? text[at] : undefined; }
function charAt(text: string, at: number): string { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at >= 0 && at < text.length ? text.charAt(at) : "-"; }
function at(text: string, place: number): string | undefined { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return place < text.length ? text.at(place) : "+"; }
function unit(text: string, at: number): number { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at >= 0 && at < text.length ? text.charCodeAt(at) : -1; }
function point(text: string, at: number): number | undefined { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at >= 0 && at < text.length ? text.codePointAt(at) : -1; }
function next(text: string, at: number): string | undefined { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return at + 1 < text.length ? text[at + 1] : undefined; }

function elements(text: string, from: number, to: number): string { let all = ""; for (let i = from | 0; i < to; i++) all += element(text, i) + ","; return all; }
function allBelow(text: string, from: number, to: number): string { let all = ""; for (let i = from | 0; i < to; i++) all += below(text, i) + ","; return all; }
function charsAt(text: string, most: number): string { let all = ""; for (let i = 0; i < most; i++) all += charAt(text, i); return all; }
function allAt(text: string, from: number, to: number): string { let all = ""; for (let i = from | 0; i < to; i++) all += at(text, i) + ","; return all; }
function units(text: string, most: number): string { let all = ""; for (let i = 0; i < most; i++) all += unit(text, i) + ","; return all; }
function points(text: string, most: number): string { let all = ""; for (let i = 0; i < most; i++) all += point(text, i) + ","; return all; }
function allNext(text: string, from: number, to: number): string { let all = ""; for (let i = from | 0; i < to; i++) all += next(text, i) + ","; return all; }

const narrow: string = JSON.parse('"abcd"');
const wide: string = JSON.parse('"a\\ud83d\\ude00\\u20acz"');
const low = Number(JSON.parse("-2")), high = Number(JSON.parse("6"));
for (const text of [narrow, wide, narrow + wide, ""]) {
  console.log(JSON.stringify([elements(text, low, high), allBelow(text, low, high), charsAt(text, high), allAt(text, low, high), units(text, high), points(text, high), allNext(text, low, high)]));
}
