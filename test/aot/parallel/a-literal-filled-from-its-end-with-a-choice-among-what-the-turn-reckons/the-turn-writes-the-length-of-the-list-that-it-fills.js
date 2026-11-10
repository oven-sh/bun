// STATISTIC: StoresThatLengthenTheirListInEveryTurn = 0
// Under: --aot-check=Validate: the storage that the literal is born with is what every access names
// Under: --aot-harden=proof-checks: what is remembered of the literal is asked of memory
// Under: --aot-testing=FailGuesses: every guess of the typed copy fails once and the turn begins again as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what the walk has proven of the list is asked of memory
'use strict';
const show = (list) => { let text = list.length + ":"; for (let i = 0; i < list.length; i++) text += (i in list ? String(list[i]) : "_") + ","; return text; };
function cutToNothingInFront(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    if (j === at) kept.length = 0;
    kept[j] = least;
  }
  return show(kept);
}
function writtenAsItIs(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    kept.length = j;
    kept[j] = least;
  }
  return show(kept);
}
function madeLongerInFront(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    if (j === at) kept.length = 20;
    kept[j] = least;
  }
  return show(kept);
}
function cutBehind(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    kept[j] = least;
    if (j === at) kept.length = 1;
  }
  return show(kept);
}
function madeLongerBehind(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    kept[j] = least;
    if (j === at) kept.length = j + 3;
  }
  return show(kept);
}
function cutByOneInEveryTurn(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    kept[j] = least;
    kept.length = j;
  }
  return show(kept);
}
function cutUnderAnotherName(given, count, first, at) {
  const most = count | 0, kept = [first | 0];
  for (let j = 1; j <= most; j++) {
    let least = given[j] + 1;
    const beside = kept[j - 1] + 2;
    if (beside < least) least = beside;
    if (j === at) { const same = kept; same.length = 0; }
    kept[j] = least;
  }
  return show(kept);
}
const rounds = +process.argv[2] || 3;
const whole = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i * 3 % 17).join() + "]");
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  for (const count of [0, 1, 4, 5, 6, 12, 30]) for (const at of [1, 2, 5, 12, 99]) all += cutToNothingInFront(whole, count, t, at) + " " + writtenAsItIs(whole, count, t, at) + " " + madeLongerInFront(whole, count, t, at) + " " + cutBehind(whole, count, t, at) + " " + madeLongerBehind(whole, count, t, at) + " " + cutByOneInEveryTurn(whole, count, t, at) + " " + cutUnderAnotherName(whole, count, t, at) + "\n";
}
console.log(all);
