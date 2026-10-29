// One turn of a loop reads a field of an instance that a list holds, tests it, stores to that field or to the element in one arm and reads the field again behind the arms.
// Each function sees one list of instances.

class RowClass {
  constructor(value) {
    this.value = value;
  }
}
function put(row, value) {
  row.value = value;
}
function f234(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) {
      rows[i].value = 3;
    }
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f234 whole ofAClass throughTheList up 1", f234(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f234 whole ofAClass throughTheList up 3", f234(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f234 whole ofAClass throughTheList up 8", f234(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f234 whole ofAClass throughTheList up 21", f234(list, list, 10), JSON.stringify(list));
}
function f235(rows, same, j) {
  let s = 0;
  let count = 0;
  let i = -1;
  for (const element of rows) {
    i++;
    if (rows[i].value === 100) {
      rows[i].value = 3;
    }
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f235 whole ofAClass throughTheList besideForOf 1", f235(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f235 whole ofAClass throughTheList besideForOf 3", f235(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f235 whole ofAClass throughTheList besideForOf 8", f235(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f235 whole ofAClass throughTheList besideForOf 21", f235(list, list, 10), JSON.stringify(list));
}
function f236(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.value === 100) row.value = 3;
    s += row.value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f236 whole ofAClass throughAName up 1", f236(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f236 whole ofAClass throughAName up 3", f236(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f236 whole ofAClass throughAName up 8", f236(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f236 whole ofAClass throughAName up 21", f236(list, list, 10), JSON.stringify(list));
}
function f237(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.value === 100) row.value = 3;
    s += row.value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f237 whole ofAClass throughAName down 1", f237(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f237 whole ofAClass throughAName down 3", f237(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f237 whole ofAClass throughAName down 8", f237(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f237 whole ofAClass throughAName down 21", f237(list, list, 10), JSON.stringify(list));
}
function f238(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.value === 100) rows[i].value = 3;
    s += row.value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f238 whole ofAClass testedThroughAName up 1", f238(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f238 whole ofAClass testedThroughAName up 3", f238(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f238 whole ofAClass testedThroughAName up 8", f238(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f238 whole ofAClass testedThroughAName up 21", f238(list, list, 10), JSON.stringify(list));
}
function f239(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    const row = rows[i];
    if (row.value === 100) rows[i].value = 3;
    s += row.value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f239 whole ofAClass testedThroughAName upToKeptLength 1", f239(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f239 whole ofAClass testedThroughAName upToKeptLength 3", f239(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f239 whole ofAClass testedThroughAName upToKeptLength 8", f239(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f239 whole ofAClass testedThroughAName upToKeptLength 21", f239(list, list, 10), JSON.stringify(list));
}
function f240(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const row = rows[i];
    if (row.value === 100) rows[i].value = 3;
    s += row.value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f240 whole ofAClass testedThroughAName byTwo 1", f240(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f240 whole ofAClass testedThroughAName byTwo 3", f240(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f240 whole ofAClass testedThroughAName byTwo 8", f240(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f240 whole ofAClass testedThroughAName byTwo 21", f240(list, list, 10), JSON.stringify(list));
}
function f241(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (rows[i].value === 100) row.value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f241 whole ofAClass storedThroughAName up 1", f241(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f241 whole ofAClass storedThroughAName up 3", f241(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f241 whole ofAClass storedThroughAName up 8", f241(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f241 whole ofAClass storedThroughAName up 21", f241(list, list, 10), JSON.stringify(list));
}
function f242(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (rows[i].value === 100) row.value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f242 whole ofAClass storedThroughAName down 1", f242(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f242 whole ofAClass storedThroughAName down 3", f242(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f242 whole ofAClass storedThroughAName down 8", f242(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f242 whole ofAClass storedThroughAName down 21", f242(list, list, 10), JSON.stringify(list));
}
function f243(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f243 whole ofAClass underAnotherName up 1", f243(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f243 whole ofAClass underAnotherName up 3", f243(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f243 whole ofAClass underAnotherName up 8", f243(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f243 whole ofAClass underAnotherName up 21", f243(list, list, 10), JSON.stringify(list));
}
function f244(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f244 whole ofAClass underAnotherName upToKeptLength 1", f244(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f244 whole ofAClass underAnotherName upToKeptLength 3", f244(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f244 whole ofAClass underAnotherName upToKeptLength 8", f244(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f244 whole ofAClass underAnotherName upToKeptLength 21", f244(list, list, 10), JSON.stringify(list));
}
function f245(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f245 whole ofAClass underAnotherName byTwo 1", f245(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f245 whole ofAClass underAnotherName byTwo 3", f245(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f245 whole ofAClass underAnotherName byTwo 8", f245(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f245 whole ofAClass underAnotherName byTwo 21", f245(list, list, 10), JSON.stringify(list));
}
function f246(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[j].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f246 whole ofAClass atAnotherIndex up 1", f246(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f246 whole ofAClass atAnotherIndex up 3", f246(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f246 whole ofAClass atAnotherIndex up 8", f246(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f246 whole ofAClass atAnotherIndex up 21", f246(list, list, 10), JSON.stringify(list));
}
function f247(rows, same, j) {
  let s = 0;
  let count = 0;
  let i = -1;
  while (++i < rows.length) {
    if (rows[i].value === 100) rows[j].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f247 whole ofAClass atAnotherIndex whileLoop 1", f247(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f247 whole ofAClass atAnotherIndex whileLoop 3", f247(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f247 whole ofAClass atAnotherIndex whileLoop 8", f247(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f247 whole ofAClass atAnotherIndex whileLoop 21", f247(list, list, 10), JSON.stringify(list));
}
function f248(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[i].value = 3;
    else rows[i].value = 7;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f248 whole ofAClass inBothArms up 1", f248(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f248 whole ofAClass inBothArms up 3", f248(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f248 whole ofAClass inBothArms up 8", f248(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f248 whole ofAClass inBothArms up 21", f248(list, list, 10), JSON.stringify(list));
}
function f249(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) rows[i].value = 3;
    else rows[i].value = 7;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f249 whole ofAClass inBothArms upToKeptLength 1", f249(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f249 whole ofAClass inBothArms upToKeptLength 3", f249(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f249 whole ofAClass inBothArms upToKeptLength 8", f249(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f249 whole ofAClass inBothArms upToKeptLength 21", f249(list, list, 10), JSON.stringify(list));
}
function f250(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) rows[i].value = 3;
    else rows[i].value = 7;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f250 whole ofAClass inBothArms byTwo 1", f250(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f250 whole ofAClass inBothArms byTwo 3", f250(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f250 whole ofAClass inBothArms byTwo 8", f250(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f250 whole ofAClass inBothArms byTwo 21", f250(list, list, 10), JSON.stringify(list));
}
function f251(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value !== 100) count++;
    else rows[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f251 whole ofAClass inOtherArm up 1", f251(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f251 whole ofAClass inOtherArm up 3", f251(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f251 whole ofAClass inOtherArm up 8", f251(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f251 whole ofAClass inOtherArm up 21", f251(list, list, 10), JSON.stringify(list));
}
function f252(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].value !== 100) count++;
    else rows[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f252 whole ofAClass inOtherArm down 1", f252(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f252 whole ofAClass inOtherArm down 3", f252(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f252 whole ofAClass inOtherArm down 8", f252(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f252 whole ofAClass inOtherArm down 21", f252(list, list, 10), JSON.stringify(list));
}
function f253(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].value === 100 && (rows[i].value = 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f253 whole ofAClass and up 1", f253(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f253 whole ofAClass and up 3", f253(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f253 whole ofAClass and up 8", f253(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f253 whole ofAClass and up 21", f253(list, list, 10), JSON.stringify(list));
}
function f254(rows, same, j) {
  let s = 0;
  let count = 0;
  let i = -1;
  while (++i < rows.length) {
    rows[i].value === 100 && (rows[i].value = 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f254 whole ofAClass and whileLoop 1", f254(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f254 whole ofAClass and whileLoop 3", f254(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f254 whole ofAClass and whileLoop 8", f254(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f254 whole ofAClass and whileLoop 21", f254(list, list, 10), JSON.stringify(list));
}
function f255(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f255 whole ofAClass conditional up 1", f255(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f255 whole ofAClass conditional up 3", f255(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f255 whole ofAClass conditional up 8", f255(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f255 whole ofAClass conditional up 21", f255(list, list, 10), JSON.stringify(list));
}
function f256(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f256 whole ofAClass conditional upToKeptLength 1", f256(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f256 whole ofAClass conditional upToKeptLength 3", f256(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f256 whole ofAClass conditional upToKeptLength 8", f256(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f256 whole ofAClass conditional upToKeptLength 21", f256(list, list, 10), JSON.stringify(list));
}
function f257(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f257 whole ofAClass conditional byTwo 1", f257(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f257 whole ofAClass conditional byTwo 3", f257(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f257 whole ofAClass conditional byTwo 8", f257(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f257 whole ofAClass conditional byTwo 21", f257(list, list, 10), JSON.stringify(list));
}
function f258(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const before = rows[i].value;
    if (before === 100) rows[i].value = 3;
    s += rows[i].value;
    s += before;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f258 whole ofAClass keptBefore up 1", f258(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f258 whole ofAClass keptBefore up 3", f258(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f258 whole ofAClass keptBefore up 8", f258(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f258 whole ofAClass keptBefore up 21", f258(list, list, 10), JSON.stringify(list));
}
function f259(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    const before = rows[i].value;
    if (before === 100) rows[i].value = 3;
    s += rows[i].value;
    s += before;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f259 whole ofAClass keptBefore upToKeptLength 1", f259(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f259 whole ofAClass keptBefore upToKeptLength 3", f259(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f259 whole ofAClass keptBefore upToKeptLength 8", f259(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f259 whole ofAClass keptBefore upToKeptLength 21", f259(list, list, 10), JSON.stringify(list));
}
function f260(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const before = rows[i].value;
    if (before === 100) rows[i].value = 3;
    s += rows[i].value;
    s += before;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f260 whole ofAClass keptBefore byTwo 1", f260(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f260 whole ofAClass keptBefore byTwo 3", f260(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f260 whole ofAClass keptBefore byTwo 8", f260(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f260 whole ofAClass keptBefore byTwo 21", f260(list, list, 10), JSON.stringify(list));
}
function f261(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[i].value = 3;
    if (rows[i].value === 3) rows[i].value = 7;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f261 whole ofAClass twoTests up 1", f261(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f261 whole ofAClass twoTests up 3", f261(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f261 whole ofAClass twoTests up 8", f261(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f261 whole ofAClass twoTests up 21", f261(list, list, 10), JSON.stringify(list));
}
function f262(rows, same, j) {
  let s = 0;
  let count = 0;
  let i = -1;
  while (++i < rows.length) {
    if (rows[i].value === 100) rows[i].value = 3;
    if (rows[i].value === 3) rows[i].value = 7;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f262 whole ofAClass twoTests whileLoop 1", f262(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f262 whole ofAClass twoTests whileLoop 3", f262(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f262 whole ofAClass twoTests whileLoop 8", f262(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f262 whole ofAClass twoTests whileLoop 21", f262(list, list, 10), JSON.stringify(list));
}
function f263(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[i] = new RowClass(3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f263 whole ofAClass theRowIsReplaced up 1", f263(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f263 whole ofAClass theRowIsReplaced up 3", f263(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f263 whole ofAClass theRowIsReplaced up 8", f263(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f263 whole ofAClass theRowIsReplaced up 21", f263(list, list, 10), JSON.stringify(list));
}
function f264(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) rows[i] = new RowClass(3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f264 whole ofAClass theRowIsReplaced upToKeptLength 1", f264(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f264 whole ofAClass theRowIsReplaced upToKeptLength 3", f264(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f264 whole ofAClass theRowIsReplaced upToKeptLength 8", f264(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f264 whole ofAClass theRowIsReplaced upToKeptLength 21", f264(list, list, 10), JSON.stringify(list));
}
function f265(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) rows[i] = new RowClass(3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f265 whole ofAClass theRowIsReplaced byTwo 1", f265(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f265 whole ofAClass theRowIsReplaced byTwo 3", f265(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f265 whole ofAClass theRowIsReplaced byTwo 8", f265(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f265 whole ofAClass theRowIsReplaced byTwo 21", f265(list, list, 10), JSON.stringify(list));
}
function f266(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) {
      const k = rows.length - 1 - i;
      const t = rows[i];
      rows[i] = rows[k];
      rows[k] = t;
    }
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f266 whole ofAClass theRowIsSwapped up 1", f266(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f266 whole ofAClass theRowIsSwapped up 3", f266(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f266 whole ofAClass theRowIsSwapped up 8", f266(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f266 whole ofAClass theRowIsSwapped up 21", f266(list, list, 10), JSON.stringify(list));
}
function f267(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) {
      const k = rows.length - 1 - i;
      const t = rows[i];
      rows[i] = rows[k];
      rows[k] = t;
    }
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f267 whole ofAClass theRowIsSwapped upToKeptLength 1", f267(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f267 whole ofAClass theRowIsSwapped upToKeptLength 3", f267(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f267 whole ofAClass theRowIsSwapped upToKeptLength 8", f267(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f267 whole ofAClass theRowIsSwapped upToKeptLength 21", f267(list, list, 10), JSON.stringify(list));
}
function f268(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) {
      const k = rows.length - 1 - i;
      const t = rows[i];
      rows[i] = rows[k];
      rows[k] = t;
    }
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f268 whole ofAClass theRowIsSwapped byTwo 1", f268(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f268 whole ofAClass theRowIsSwapped byTwo 3", f268(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f268 whole ofAClass theRowIsSwapped byTwo 8", f268(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f268 whole ofAClass theRowIsSwapped byTwo 21", f268(list, list, 10), JSON.stringify(list));
}
function f269(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) put(rows[i], 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f269 whole ofAClass byAFunction up 1", f269(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f269 whole ofAClass byAFunction up 3", f269(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f269 whole ofAClass byAFunction up 8", f269(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f269 whole ofAClass byAFunction up 21", f269(list, list, 10), JSON.stringify(list));
}
function f270(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].value === 100) put(rows[i], 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f270 whole ofAClass byAFunction down 1", f270(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f270 whole ofAClass byAFunction down 3", f270(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f270 whole ofAClass byAFunction down 8", f270(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f270 whole ofAClass byAFunction down 21", f270(list, list, 10), JSON.stringify(list));
}
function f271(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value !== 100) {
      s += rows[i].value;
      continue;
    }
    rows[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f271 whole ofAClass goesOn up 1", f271(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f271 whole ofAClass goesOn up 3", f271(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f271 whole ofAClass goesOn up 8", f271(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f271 whole ofAClass goesOn up 21", f271(list, list, 10), JSON.stringify(list));
}
function f272(rows, same, j) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].value !== 100) {
      s += rows[i].value;
      continue;
    }
    rows[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list = [1].map(v => new RowClass(v));
  console.log("f272 whole ofAClass goesOn down 1", f272(list, list, 0), JSON.stringify(list));
}
{
  const list = [1, 100, 3].map(v => new RowClass(v));
  console.log("f272 whole ofAClass goesOn down 3", f272(list, list, 1), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100].map(v => new RowClass(v));
  console.log("f272 whole ofAClass goesOn down 8", f272(list, list, 4), JSON.stringify(list));
}
{
  const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21].map(
    v => new RowClass(v),
  );
  console.log("f272 whole ofAClass goesOn down 21", f272(list, list, 10), JSON.stringify(list));
}
