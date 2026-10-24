// In a checked file a parameter, a variable and a result keep the checker's type: a value is tested against it where it arrives. What the uses say is expected of expressions and of `this` only.
declare const values: any[];
// parameter `a: any` = any
// predicted `a` = number
function written(a: any) { return a * 2; }
// parameter `item` = any
// predicted `item` = { id?: any; }
values.forEach(item => item.id);
// parameter `text` = string
["a"].forEach(text => text.length);
function locals(source: any) {
  // binding `written` = any
  const written: any = source;
  // binding `unwritten` = any
  const unwritten = source;
  // predicted `unwritten` = { id?: any; }
  return [written.id, unwritten.id];
}
// returns `result` = any
function result(source: any) { const row = source; row.id; return row; }
// predicted `result(values)` = { id?: any; }
result(values);
function walk(list: number[]) {
  // binding `at` = number
  let at = 0;
  // predicted `at` = int32
  while (list[at]) at += 2;
}
// Nothing tests the `this` of a function that is no member of a class. `noImplicitThis` reports this one, which changes no answer.
// signature `Counter` = () this unwritten checked { count?: number; } returns unwritten checked void
function Counter() { this.count = 0; }
