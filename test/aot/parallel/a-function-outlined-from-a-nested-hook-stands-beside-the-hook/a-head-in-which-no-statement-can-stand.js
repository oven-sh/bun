// Flags: --react-compiler
// A closure among the parameters of a function, in the head of a loop or in the parameter of a `catch` does not see what the body declares. What is moved out of it is declared in the closure itself.
const rate = 100, self = { rate: 100 };
const made = [];
function priced(rate, bill = function (items) { "use memo"; return items.map(n => n * rate).join("+"); }) { return bill; }
const short = (rate, bill = function (items) { "use memo"; return items.map(n => n * rate).join("+"); }) => bill;
function taken({ rate, bill = function (items) { "use memo"; return items.map(n => n * rate).join("+"); } }) { return bill; }
function empty(rate, bill = made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); })) {}
const named = function self(bill = function (items) { "use memo"; return items.map(n => n * self.rate).join("+"); }) { return bill; };
named.rate = 7;
made.push(priced(3), short(4), taken({ rate: 5 }));
empty(6);
made.push(named());
for (let rate = 8, bill = function (items) { "use memo"; return items.map(n => n * rate).join("+"); }; made.length < 6; ) made.push(bill);
try { throw { rate: 9 }; } catch ({ rate, bill = function (items) { "use memo"; return items.map(n => n * rate).join("+"); } }) { made.push(bill); }
console.log(made.map(bill => bill([1, 2])).join());
