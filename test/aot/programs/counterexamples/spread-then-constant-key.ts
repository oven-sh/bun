// The keys after a spread that were right while a literal index was wrong (spread-then-index-key.ts): enum members, constants, a template, a key in third place.
enum Plain { Zero, One, Two }
const enum Constant { Zero, One, Two }
const fixed = 1;
const fixedString = "1";
const table = { one: 1 } as const;
function look(x: unknown): string { const o = x as any; return Reflect.ownKeys(o).join() + " " + o[1]; }
const plainEnum = (o: any, k: number): string => look({ ...o, [Plain.One]: k });
const constEnum = (o: any, k: number): string => look({ ...o, [Constant.One]: k });
const constNumber = (o: any, k: number): string => look({ ...o, [fixed]: k });
const constString = (o: any, k: number): string => look({ ...o, [fixedString]: k });
const constMember = (o: any, k: number): string => look({ ...o, [table.one]: k });
const template = (o: any, k: number): string => look({ ...o, [`1`]: k });
const third = (o: any, k: number): string => look({ ...o, b: k, c: k, 1: k });
const second = (o: any, k: number): string => look({ ...o, b: k, 1: k });
console.log("plainEnum", plainEnum({ a: 1 }, 7));
console.log("constEnum", constEnum({ a: 1 }, 7));
console.log("constNumber", constNumber({ a: 1 }, 7));
console.log("constString", constString({ a: 1 }, 7));
console.log("constMember", constMember({ a: 1 }, 7));
console.log("template", template({ a: 1 }, 7));
console.log("third", third({ a: 1 }, 7));
console.log("second", second({ a: 1 }, 7));
