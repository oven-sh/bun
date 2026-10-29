// One turn of a loop reads a field of an element, tests it, stores to that field or to the element in one arm and reads the field again behind the arms.
// Each function sees one list of rows.

type Row = { value: number };
function put(row: Row, value: number) {
  row.value = value;
}
function f0(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f0 whole literal throughTheList up 1", f0(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f0 whole literal throughTheList up 3", f0(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f0 whole literal throughTheList up 8", f0(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f0 whole literal throughTheList up 21", f0(list, list, 10), JSON.stringify(list));
}
function f1(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f1 whole literal throughTheList besideForOf 1", f1(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f1 whole literal throughTheList besideForOf 3", f1(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f1 whole literal throughTheList besideForOf 8", f1(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f1 whole literal throughTheList besideForOf 21", f1(list, list, 10), JSON.stringify(list));
}
function f2(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f2 whole literal throughAName up 1", f2(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f2 whole literal throughAName up 3", f2(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f2 whole literal throughAName up 8", f2(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f2 whole literal throughAName up 21", f2(list, list, 10), JSON.stringify(list));
}
function f3(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f3 whole literal throughAName down 1", f3(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f3 whole literal throughAName down 3", f3(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f3 whole literal throughAName down 8", f3(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f3 whole literal throughAName down 21", f3(list, list, 10), JSON.stringify(list));
}
function f4(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f4 whole literal testedThroughAName up 1", f4(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f4 whole literal testedThroughAName up 3", f4(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f4 whole literal testedThroughAName up 8", f4(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f4 whole literal testedThroughAName up 21", f4(list, list, 10), JSON.stringify(list));
}
function f5(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f5 whole literal testedThroughAName upToKeptLength 1", f5(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f5 whole literal testedThroughAName upToKeptLength 3", f5(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f5 whole literal testedThroughAName upToKeptLength 8", f5(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f5 whole literal testedThroughAName upToKeptLength 21", f5(list, list, 10), JSON.stringify(list));
}
function f6(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f6 whole literal testedThroughAName byTwo 1", f6(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f6 whole literal testedThroughAName byTwo 3", f6(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f6 whole literal testedThroughAName byTwo 8", f6(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f6 whole literal testedThroughAName byTwo 21", f6(list, list, 10), JSON.stringify(list));
}
function f7(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f7 whole literal storedThroughAName up 1", f7(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f7 whole literal storedThroughAName up 3", f7(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f7 whole literal storedThroughAName up 8", f7(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f7 whole literal storedThroughAName up 21", f7(list, list, 10), JSON.stringify(list));
}
function f8(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f8 whole literal storedThroughAName down 1", f8(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f8 whole literal storedThroughAName down 3", f8(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f8 whole literal storedThroughAName down 8", f8(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f8 whole literal storedThroughAName down 21", f8(list, list, 10), JSON.stringify(list));
}
function f9(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f9 whole literal underAnotherName up 1", f9(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f9 whole literal underAnotherName up 3", f9(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f9 whole literal underAnotherName up 8", f9(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f9 whole literal underAnotherName up 21", f9(list, list, 10), JSON.stringify(list));
}
function f10(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f10 whole literal underAnotherName upToKeptLength 1", f10(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f10 whole literal underAnotherName upToKeptLength 3", f10(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f10 whole literal underAnotherName upToKeptLength 8", f10(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f10 whole literal underAnotherName upToKeptLength 21", f10(list, list, 10), JSON.stringify(list));
}
function f11(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) same[i].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f11 whole literal underAnotherName byTwo 1", f11(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f11 whole literal underAnotherName byTwo 3", f11(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f11 whole literal underAnotherName byTwo 8", f11(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f11 whole literal underAnotherName byTwo 21", f11(list, list, 10), JSON.stringify(list));
}
function f12(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[j].value = 3;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f12 whole literal atAnotherIndex up 1", f12(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f12 whole literal atAnotherIndex up 3", f12(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f12 whole literal atAnotherIndex up 8", f12(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f12 whole literal atAnotherIndex up 21", f12(list, list, 10), JSON.stringify(list));
}
function f13(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f13 whole literal atAnotherIndex whileLoop 1", f13(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f13 whole literal atAnotherIndex whileLoop 3", f13(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f13 whole literal atAnotherIndex whileLoop 8", f13(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f13 whole literal atAnotherIndex whileLoop 21", f13(list, list, 10), JSON.stringify(list));
}
function f14(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f14 whole literal inBothArms up 1", f14(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f14 whole literal inBothArms up 3", f14(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f14 whole literal inBothArms up 8", f14(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f14 whole literal inBothArms up 21", f14(list, list, 10), JSON.stringify(list));
}
function f15(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f15 whole literal inBothArms upToKeptLength 1", f15(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f15 whole literal inBothArms upToKeptLength 3", f15(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f15 whole literal inBothArms upToKeptLength 8", f15(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f15 whole literal inBothArms upToKeptLength 21", f15(list, list, 10), JSON.stringify(list));
}
function f16(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f16 whole literal inBothArms byTwo 1", f16(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f16 whole literal inBothArms byTwo 3", f16(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f16 whole literal inBothArms byTwo 8", f16(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f16 whole literal inBothArms byTwo 21", f16(list, list, 10), JSON.stringify(list));
}
function f17(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f17 whole literal inOtherArm up 1", f17(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f17 whole literal inOtherArm up 3", f17(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f17 whole literal inOtherArm up 8", f17(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f17 whole literal inOtherArm up 21", f17(list, list, 10), JSON.stringify(list));
}
function f18(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f18 whole literal inOtherArm down 1", f18(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f18 whole literal inOtherArm down 3", f18(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f18 whole literal inOtherArm down 8", f18(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f18 whole literal inOtherArm down 21", f18(list, list, 10), JSON.stringify(list));
}
function f19(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].value === 100 && (rows[i].value = 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f19 whole literal and up 1", f19(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f19 whole literal and up 3", f19(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f19 whole literal and up 8", f19(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f19 whole literal and up 21", f19(list, list, 10), JSON.stringify(list));
}
function f20(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f20 whole literal and whileLoop 1", f20(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f20 whole literal and whileLoop 3", f20(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f20 whole literal and whileLoop 8", f20(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f20 whole literal and whileLoop 21", f20(list, list, 10), JSON.stringify(list));
}
function f21(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f21 whole literal conditional up 1", f21(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f21 whole literal conditional up 3", f21(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f21 whole literal conditional up 8", f21(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f21 whole literal conditional up 21", f21(list, list, 10), JSON.stringify(list));
}
function f22(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f22 whole literal conditional upToKeptLength 1", f22(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f22 whole literal conditional upToKeptLength 3", f22(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f22 whole literal conditional upToKeptLength 8", f22(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f22 whole literal conditional upToKeptLength 21", f22(list, list, 10), JSON.stringify(list));
}
function f23(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    s += rows[i].value === 100 ? (rows[i].value = 3) : rows[i].value;
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f23 whole literal conditional byTwo 1", f23(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f23 whole literal conditional byTwo 3", f23(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f23 whole literal conditional byTwo 8", f23(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f23 whole literal conditional byTwo 21", f23(list, list, 10), JSON.stringify(list));
}
function f24(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f24 whole literal keptBefore up 1", f24(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f24 whole literal keptBefore up 3", f24(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f24 whole literal keptBefore up 8", f24(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f24 whole literal keptBefore up 21", f24(list, list, 10), JSON.stringify(list));
}
function f25(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f25 whole literal keptBefore upToKeptLength 1", f25(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f25 whole literal keptBefore upToKeptLength 3", f25(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f25 whole literal keptBefore upToKeptLength 8", f25(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f25 whole literal keptBefore upToKeptLength 21", f25(list, list, 10), JSON.stringify(list));
}
function f26(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f26 whole literal keptBefore byTwo 1", f26(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f26 whole literal keptBefore byTwo 3", f26(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f26 whole literal keptBefore byTwo 8", f26(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f26 whole literal keptBefore byTwo 21", f26(list, list, 10), JSON.stringify(list));
}
function f27(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f27 whole literal twoTests up 1", f27(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f27 whole literal twoTests up 3", f27(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f27 whole literal twoTests up 8", f27(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f27 whole literal twoTests up 21", f27(list, list, 10), JSON.stringify(list));
}
function f28(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f28 whole literal twoTests whileLoop 1", f28(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f28 whole literal twoTests whileLoop 3", f28(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f28 whole literal twoTests whileLoop 8", f28(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f28 whole literal twoTests whileLoop 21", f28(list, list, 10), JSON.stringify(list));
}
function f29(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) rows[i] = { value: 3 };
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f29 whole literal theRowIsReplaced up 1", f29(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f29 whole literal theRowIsReplaced up 3", f29(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f29 whole literal theRowIsReplaced up 8", f29(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f29 whole literal theRowIsReplaced up 21", f29(list, list, 10), JSON.stringify(list));
}
function f30(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0, n = rows.length; i < n; i++) {
    if (rows[i].value === 100) rows[i] = { value: 3 };
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f30 whole literal theRowIsReplaced upToKeptLength 1", f30(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f30 whole literal theRowIsReplaced upToKeptLength 3", f30(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f30 whole literal theRowIsReplaced upToKeptLength 8", f30(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f30 whole literal theRowIsReplaced upToKeptLength 21", f30(list, list, 10), JSON.stringify(list));
}
function f31(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i += 2) {
    if (rows[i].value === 100) rows[i] = { value: 3 };
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f31 whole literal theRowIsReplaced byTwo 1", f31(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f31 whole literal theRowIsReplaced byTwo 3", f31(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f31 whole literal theRowIsReplaced byTwo 8", f31(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f31 whole literal theRowIsReplaced byTwo 21", f31(list, list, 10), JSON.stringify(list));
}
function f32(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f32 whole literal theRowIsSwapped up 1", f32(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f32 whole literal theRowIsSwapped up 3", f32(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f32 whole literal theRowIsSwapped up 8", f32(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f32 whole literal theRowIsSwapped up 21", f32(list, list, 10), JSON.stringify(list));
}
function f33(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f33 whole literal theRowIsSwapped upToKeptLength 1", f33(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f33 whole literal theRowIsSwapped upToKeptLength 3", f33(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f33 whole literal theRowIsSwapped upToKeptLength 8", f33(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f33 whole literal theRowIsSwapped upToKeptLength 21", f33(list, list, 10), JSON.stringify(list));
}
function f34(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f34 whole literal theRowIsSwapped byTwo 1", f34(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f34 whole literal theRowIsSwapped byTwo 3", f34(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f34 whole literal theRowIsSwapped byTwo 8", f34(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f34 whole literal theRowIsSwapped byTwo 21", f34(list, list, 10), JSON.stringify(list));
}
function f35(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value === 100) put(rows[i], 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f35 whole literal byAFunction up 1", f35(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f35 whole literal byAFunction up 3", f35(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f35 whole literal byAFunction up 8", f35(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f35 whole literal byAFunction up 21", f35(list, list, 10), JSON.stringify(list));
}
function f36(rows: Row[], same: Row[], j: number) {
  let s = 0;
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].value === 100) put(rows[i], 3);
    s += rows[i].value;
  }
  return s + " " + count;
}
{
  const list: Row[] = [{ value: 1 }];
  console.log("f36 whole literal byAFunction down 1", f36(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f36 whole literal byAFunction down 3", f36(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f36 whole literal byAFunction down 8", f36(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f36 whole literal byAFunction down 21", f36(list, list, 10), JSON.stringify(list));
}
function f37(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f37 whole literal goesOn up 1", f37(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f37 whole literal goesOn up 3", f37(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f37 whole literal goesOn up 8", f37(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f37 whole literal goesOn up 21", f37(list, list, 10), JSON.stringify(list));
}
function f38(rows: Row[], same: Row[], j: number) {
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
  const list: Row[] = [{ value: 1 }];
  console.log("f38 whole literal goesOn down 1", f38(list, list, 0), JSON.stringify(list));
}
{
  const list: Row[] = [{ value: 1 }, { value: 100 }, { value: 3 }];
  console.log("f38 whole literal goesOn down 3", f38(list, list, 1), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
  ];
  console.log("f38 whole literal goesOn down 8", f38(list, list, 4), JSON.stringify(list));
}
{
  const list: Row[] = [
    { value: 1 },
    { value: 100 },
    { value: 3 },
    { value: 4 },
    { value: 100 },
    { value: 6 },
    { value: 7 },
    { value: 100 },
    { value: 9 },
    { value: 10 },
    { value: 100 },
    { value: 100 },
    { value: 13 },
    { value: 100 },
    { value: 15 },
    { value: 16 },
    { value: 100 },
    { value: 18 },
    { value: 100 },
    { value: 100 },
    { value: 21 },
  ];
  console.log("f38 whole literal goesOn down 21", f38(list, list, 10), JSON.stringify(list));
}

function total(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 100) {
      a[i] = 3;
    }
    s += a[i];
  }
  return s;
}
for (let k = 0; k < 3; k++) {
  const a: number[] = new Array(3);
  a[0] = 1;
  a[1] = 100;
  a[2] = 2;
  console.log(total(a), JSON.stringify(a));
}

type Value = { value: number };
function totalOfParsed(rows: Value[]): number {
  let s = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.value === 100) rows[i].value = 3;
    s += row.value;
  }
  return s;
}
{
  const rows = (JSON.parse("[1,100,2,100,100,5,6,7,100,9]") as number[]).map((v: number) => ({ value: v }));
  console.log(totalOfParsed(rows), JSON.stringify(rows));
}
