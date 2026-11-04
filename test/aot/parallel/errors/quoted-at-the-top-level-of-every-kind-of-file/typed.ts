import { tell } from "./tell.ts";

/** Types take lines and columns of the file that the kept text does not have. */
interface Shape<T> {
  value: T | null;
  list: T[];
}
type Pair = [number, string];
declare const absent: Shape<number>;
const shape: Shape<{ x: number }> = { value: null, list: [] };
enum Color { Red, Green }
console.log(Color.Green);
try { const x: number = shape.value!.x; console.log(x); } catch (error) { tell("typed read", error); }
try { console.log("x" in (shape.value as unknown as object)); } catch (error) { tell("typed key test", error); }
try { console.log(Object.keys(shape.value as object) as string[]); } catch (error) { tell("typed keys", error); }
try { console.log((shape.list[shape.list.length] as { x: number }).x satisfies number); } catch (error) { tell("typed element", error); }
function generic<T extends object>(value: T | null): T[keyof T] {
  return value![Object.keys(value!)[0] as keyof T];
}
try { generic<{ a: 1 }>(null); } catch (error) { tell("typed function", error); }
try { const [first]: Pair = shape.value as unknown as Pair; console.log(first); } catch (error) { tell("typed list pattern", error); }
