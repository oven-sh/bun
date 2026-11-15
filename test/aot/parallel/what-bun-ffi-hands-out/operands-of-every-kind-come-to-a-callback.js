// Native code hands a callback numbers, bigints, booleans, texts and null, and converts what it answers.
import { CFunction, JSCallback } from "bun:ffi";

const seen = [];
const signature = { args: ["i32", "i64", "u64", "bool", "cstring", "ptr", "f32", "u8"], returns: "i64" };
const noted = new JSCallback((...operands) => {
  for (const operand of operands) seen.push(`${typeof operand} ${String(operand)}`);
  return operands.length;
}, signature);
const enter = CFunction({ ...signature, ptr: noted.ptr });
const answer = enter(-7, -8n, 9n, true, Buffer.from("words\0"), null, 0.5, 300);
console.log(seen.join(" | "));
console.log(typeof answer, String(answer));
noted.close();
