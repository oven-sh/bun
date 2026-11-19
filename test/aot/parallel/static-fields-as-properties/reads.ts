import { plain } from "./loop.ts";
interface Holder {
  words: string[];
  word: string | undefined;
}
export function add(total: any, value: any): any {
  return plain(total) + plain(value);
}
export function readWord(holder: Holder, count: number): any {
  let total: any = 0;
  for (let turn = 0; turn < count; turn++) total = add(total, holder.word ?? "none");
  return total;
}
