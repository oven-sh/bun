// An index signature whose key is not `string`, and more than one index signature, cannot be validated: the build stops and names the type or the property.
import { validate } from "bun:bundle";
type NumberKeys = { [key: number]: string };
type SymbolKeys = { [key: symbol]: string };
type PatternKeys = { [key: `data-${string}`]: string };
type TwoSignatures = { [key: string]: unknown; [key: number]: string };
type Holder = { id: number; byIndex: NumberKeys };
console.log(JSON.parse<NumberKeys>("{}"));
console.log(JSON.parse<SymbolKeys>("{}"));
console.log(JSON.parse<PatternKeys>("{}"));
console.log(JSON.parse<TwoSignatures>("{}"));
console.log(JSON.parse<Holder>('{"id":1,"byIndex":{}}'));
console.log(validate<NumberKeys[]>([]));
console.log(JSON.parse<{ [key: string]: string }>("{}"));
