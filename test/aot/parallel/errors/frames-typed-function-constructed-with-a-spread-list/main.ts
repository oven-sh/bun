// A function that takes a list of numbers and returns a number is called with one by its own file, which uses the result, and constructed with a spread list by a package without types. What it throws lists it once, as constructed.
import { construct, note } from "constructs-its-callback";
function total(list: number[]): any {
  let sum: any = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] >= 100) list[index] = -1;
    sum = sum + list[index];
  }
  return sum;
}
const list: any = [100, 2, 3, 4, 100, 6, 7, 8];
note(total(list));
note(list);
console.log(construct(total));
