// A call of what is no function throws a TypeError, and so do a call of a class and `new` of what is no constructor, also where nobody uses the result and every function that can arrive does nothing. Each call stands in a method of an object literal that is called at once.
const given = JSON.parse('{ "off": false }');

function scene0(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene0(0); console.log("a number is called: returned"); } catch (error) { console.log("a number is called: " + error.name); }

function scene1(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene1("text"); console.log("a text is called: returned"); } catch (error) { console.log("a text is called: " + error.name); }

function scene2(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene2(undefined); console.log("undefined is called: returned"); } catch (error) { console.log("undefined is called: " + error.name); }

function scene3(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene3(null); console.log("null is called: returned"); } catch (error) { console.log("null is called: " + error.name); }

function scene4(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene4(class {}); console.log("a class is called: returned"); } catch (error) { console.log("a class is called: " + error.name); }

function scene5(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ outer() { ({ answers() { x(); } }).answers(); } }).outer();
}
try { scene5(class extends Object {}); console.log("a derived class is called: returned"); } catch (error) { console.log("a derived class is called: " + error.name); }

function scene6(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(1, 2); } }).answers();
}
try { scene6(0); console.log("a number is called with arguments: returned"); } catch (error) { console.log("a number is called with arguments: " + error.name); }

function scene7(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x?.(); } }).answers();
}
try { scene7(0); console.log("a number is called if it is there: returned"); } catch (error) { console.log("a number is called if it is there: " + error.name); }

function scene8(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x?.(); } }).answers();
}
try { scene8(undefined); console.log("undefined is called if it is there: returned"); } catch (error) { console.log("undefined is called if it is there: " + error.name); }

function scene9(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x?.(); } }).answers();
}
try { scene9(class {}); console.log("a class is called if it is there: returned"); } catch (error) { console.log("a class is called if it is there: " + error.name); }

function scene10(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x`text`; } }).answers();
}
try { scene10(0); console.log("a number is the tag of a template: returned"); } catch (error) { console.log("a number is the tag of a template: " + error.name); }

function scene11(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ outer() { ({ answers() { x`text`; } }).answers(); } }).outer();
}
try { scene11(class {}); console.log("a class is the tag of a template: returned"); } catch (error) { console.log("a class is the tag of a template: " + error.name); }

function scene12(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { ({ member: x }).member(); } }).answers();
}
try { scene12(0); console.log("a number is called as a member: returned"); } catch (error) { console.log("a number is called as a member: " + error.name); }

function scene13(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { ({ member: x }).member(); } }).answers();
}
try { scene13(class {}); console.log("a class is called as a member: returned"); } catch (error) { console.log("a class is called as a member: " + error.name); }

function scene14(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { ({ member: x }).member?.(); } }).answers();
}
try { scene14(0); console.log("a number is called as a member if it is there: returned"); } catch (error) { console.log("a number is called as a member if it is there: " + error.name); }

function scene15(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { [x][0](); } }).answers();
}
try { scene15(0); console.log("a number is called as an element: returned"); } catch (error) { console.log("a number is called as an element: " + error.name); }

function scene16(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ answers() { new x(); } }).answers();
}
try { scene16(0); console.log("a number is constructed: returned"); } catch (error) { console.log("a number is constructed: " + error.name); }

function scene17(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ outer() { ({ answers() { new x; } }).answers(); } }).outer();
}
try { scene17(undefined); console.log("undefined is constructed: returned"); } catch (error) { console.log("undefined is constructed: " + error.name); }

function scene18(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ answers() { new x(); } }).answers();
}
try { scene18(() => 1); console.log("an arrow function is constructed: returned"); } catch (error) { console.log("an arrow function is constructed: " + error.name); }

function scene19(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ answers() { new x(); } }).answers();
}
try { scene19(({ method() {} }).method); console.log("a method is constructed: returned"); } catch (error) { console.log("a method is constructed: " + error.name); }

function scene20(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ answers() { new x(); } }).answers();
}
try { scene20(async function () {}); console.log("an async function is constructed: returned"); } catch (error) { console.log("an async function is constructed: " + error.name); }

function scene21(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ answers() { new x(); } }).answers();
}
try { scene21(function* () {}); console.log("a generator function is constructed: returned"); } catch (error) { console.log("a generator function is constructed: " + error.name); }

function scene22(arrives) {
  let x = arrives;
  if (given.off) x = () => 1;
  ({ answers() { x(); } }).answers();
}
try { scene22(() => 2); console.log("a function is called: returned"); } catch (error) { console.log("a function is called: " + error.name); }

function scene23(arrives) {
  let x = arrives;
  if (given.off) x = function () {};
  ({ outer() { ({ answers() { new x(); } }).answers(); } }).outer();
}
try { scene23(function () {}); console.log("a function is constructed: returned"); } catch (error) { console.log("a function is constructed: " + error.name); }
