// All members of a union have the same field names, inherited from a common base type.
interface Message { text: string }
interface Base { name: string; type: "string" | "number" | "boolean" | "object" | "list" | Map<string, number | string>; about?: string | number | boolean | Message }
interface OfBoolean extends Base { type: "boolean"; about?: boolean | Message }
interface OfString extends Base { type: "string"; about?: string | Message }
interface OfNumber extends Base { type: "number"; about?: number | Message }
interface OfObject extends Base { type: "object" }
interface OfList extends Base { type: "list" }
interface OfCustom extends Base { type: Map<string, number | string>; about?: number | string | Message }
type Option = OfCustom | OfString | OfNumber | OfBoolean | OfObject | OfList
const options: Option[] = [
  { name: "watch", type: new Map(Object.entries({ x: 1, y: 2 })), about: 4 },
  { name: "flag", type: "boolean", about: true },
  { name: "text", type: "string", about: { text: "t" } },
]
for (const o of options) console.log(o.name, typeof o.type === "string" ? o.type : o.type.size, typeof o.about)
export {}
