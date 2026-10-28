// Lists written as constants are asked what they hold, changed by built-ins, and asked again.
function show(value: unknown): string {
  return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
}
const list0: any[] = [3, 7, 0, 2, 1];
function ask0(): string {
  return [
    show(list0.join("|")),
    show(list0.join("|")),
    show(
      (() => {
        let text = "";
        for (const each of list0) text += String(each) + ",";
        return text;
      })(),
    ),
    show(
      (() => {
        let text = "";
        for (const each of list0) text += String(each) + ",";
        return text;
      })(),
    ),
  ].join(" ");
}
function change0(): void {
  Array.prototype.push.call(list0, -2147483648);
}
{
  let before = "";
  for (let turn = 0; turn < 1; turn++) before = ask0();
  let thrown = "";
  try {
    change0();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("push by call" + ": " + before + " > " + ask0() + thrown);
}
const list1: any[] = ["0", "z"];
function ask1(): string {
  return [
    show(list1.lastIndexOf("0")),
    show(list1.lastIndexOf("b")),
    show(
      (() => {
        let text = "";
        for (const each of list1) text += String(each) + ",";
        return text;
      })(),
    ),
    show(
      (() => {
        let text = "";
        for (const each of list1) text += String(each) + ",";
        return text;
      })(),
    ),
    show(list1.some(each => Object.is(each, "0"))),
    show(list1.some(each => Object.is(each, "b"))),
    show(list1.find(each => Object.is(each, "0"))),
    show(list1.find(each => Object.is(each, "b"))),
  ].join(" ");
}
function change1(): void {
  Reflect.deleteProperty(list1, 0);
}
{
  let before = "";
  for (let turn = 0; turn < 3; turn++) before = ask1();
  let thrown = "";
  try {
    change1();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("Reflect.deleteProperty" + ": " + before + " > " + ask1() + thrown);
}
export const list2: any[] = ["a", "c", "0", "d"];
function ask2(): string {
  return [
    show(
      (() => {
        const [first, second] = list2;
        return String(first) + String(second);
      })(),
    ),
    show(
      (() => {
        const [first, second] = list2;
        return String(first) + String(second);
      })(),
    ),
    show(list2.every(each => !Object.is(each, "a"))),
    show(list2.every(each => !Object.is(each, "b"))),
  ].join(" ");
}
function change2(): void {
  list2.fill("b");
}
{
  let before = "";
  for (let turn = 0; turn < 200; turn++) before = ask2();
  let thrown = "";
  try {
    change2();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("fill" + ": " + before + " > " + ask2() + thrown);
}
const list3: any[] = [2147483647, 3, -1];
function ask3(): string {
  return [
    show(list3[0]),
    show(list3[0]),
    show(
      (() => {
        let text = "";
        for (const each of list3) text += String(each) + ",";
        return text;
      })(),
    ),
    show(
      (() => {
        let text = "";
        for (const each of list3) text += String(each) + ",";
        return text;
      })(),
    ),
  ].join(" ");
}
function change3(): void {
  Object.defineProperty(list3, 0, { value: 7 });
}
{
  let before = "";
  for (let turn = 0; turn < 1; turn++) before = ask3();
  let thrown = "";
  try {
    change3();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("Object.defineProperty" + ": " + before + " > " + ask3() + thrown);
}
const list4: any[] = [-1, 7];
function ask4(): string {
  return [
    show(list4.at(0)),
    show(list4.at(0)),
    show(list4.at(-1)),
    show(list4.at(-1)),
    show(list4[0]),
    show(list4[0]),
  ].join(" ");
}
function change4(): void {
  list4.reverse();
}
{
  let before = "";
  for (let turn = 0; turn < 200; turn++) before = ask4();
  let thrown = "";
  try {
    change4();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("reverse" + ": " + before + " > " + ask4() + thrown);
}
export const list5: any[] = [3, 2147483647, 1, 7, 2];
function ask5(): string {
  return [
    show(list5.find(each => Object.is(each, 3))),
    show(list5.find(each => Object.is(each, -1))),
    show(list5.every(each => !Object.is(each, 3))),
    show(list5.every(each => !Object.is(each, -1))),
    show(list5.at(0)),
    show(list5.at(0)),
  ].join(" ");
}
function change5(): void {
  Array.prototype.fill.apply(list5, [-1]);
}
{
  let before = "";
  for (let turn = 0; turn < 1; turn++) before = ask5();
  let thrown = "";
  try {
    change5();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("fill by apply" + ": " + before + " > " + ask5() + thrown);
}
let list6: any[] = ["d", "b", "0", "z"];
function ask6(): string {
  return [
    show(
      (() => {
        const [first, second] = list6;
        return String(first) + String(second);
      })(),
    ),
    show(
      (() => {
        const [first, second] = list6;
        return String(first) + String(second);
      })(),
    ),
    show(list6.length),
    show(list6.length),
    show(0 in list6),
    show(0 in list6),
    show(
      (() => {
        let text = "";
        for (const each of list6) text += String(each) + ",";
        return text;
      })(),
    ),
    show(
      (() => {
        let text = "";
        for (const each of list6) text += String(each) + ",";
        return text;
      })(),
    ),
    show(list6.lastIndexOf("d")),
    show(list6.lastIndexOf("a")),
  ].join(" ");
}
function change6(): void {
  const holder = [list6];
  holder[0][0] = "a";
}
{
  let before = "";
  for (let turn = 0; turn < 200; turn++) before = ask6();
  let thrown = "";
  try {
    change6();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("an element of a holder" + ": " + before + " > " + ask6() + thrown);
}
const list7: any[] = [1e21, 1.5, NaN, -0];
function ask7(): string {
  return [show(list7.lastIndexOf(1e21)), show(list7.lastIndexOf(0.5)), show(list7[1]), show(list7[1])].join(" ");
}
function change7(): void {
  list7.unshift(0.5);
}
{
  let before = "";
  for (let turn = 0; turn < 3; turn++) before = ask7();
  let thrown = "";
  try {
    change7();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("unshift" + ": " + before + " > " + ask7() + thrown);
}
export const list8: any[] = [-2147483648, 2147483647, 0];
function ask8(): string {
  return [
    show([...list8].length),
    show([...list8].length),
    show(list8.join("|")),
    show(list8.join("|")),
    show(list8.at(-1)),
    show(list8.at(-1)),
    show(list8.includes(-2147483648)),
    show(list8.includes(7)),
  ].join(" ");
}
function change8(): void {
  list8.splice(0, 1, 7);
}
{
  let before = "";
  for (let turn = 0; turn < 1; turn++) before = ask8();
  let thrown = "";
  try {
    change8();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("splice" + ": " + before + " > " + ask8() + thrown);
}
const list9: any[] = [-0, -2147483648, 2147483647, 1.5];
function ask9(): string {
  return [
    show(
      (() => {
        let text = "";
        for (const each of list9) text += String(each) + ",";
        return text;
      })(),
    ),
    show(
      (() => {
        let text = "";
        for (const each of list9) text += String(each) + ",";
        return text;
      })(),
    ),
    show([...list9].length),
    show([...list9].length),
    show(list9.lastIndexOf(-0)),
    show(list9.lastIndexOf(4294967296)),
  ].join(" ");
}
function change9(): void {
  (function* (list: any) {
    list[0] = 4294967296;
  })(list9).next();
}
{
  let before = "";
  for (let turn = 0; turn < 3; turn++) before = ask9();
  let thrown = "";
  try {
    change9();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("a generator" + ": " + before + " > " + ask9() + thrown);
}
const list10: any[] = [4294967296, -1, "0", undefined, "c"];
const alsoNamed10 = list10;
function ask10(): string {
  return [
    show(list10.lastIndexOf(4294967296)),
    show(list10.lastIndexOf("z")),
    show(list10.length),
    show(list10.length),
    show(
      (() => {
        const [first, second] = list10;
        return String(first) + String(second);
      })(),
    ),
    show(
      (() => {
        const [first, second] = list10;
        return String(first) + String(second);
      })(),
    ),
    show(list10.join("|")),
    show(list10.join("|")),
    show(0 in list10),
    show(0 in list10),
  ].join(" ");
}
function change10(): void {
  Reflect.set(list10, 0, "z");
}
{
  let before = "";
  for (let turn = 0; turn < 1; turn++) before = ask10();
  let thrown = "";
  try {
    change10();
  } catch (error) {
    thrown = " THROWS " + (error as Error).constructor.name;
  }
  console.log("Reflect.set" + ": " + before + " > " + ask10() + thrown);
}
