// A call of a built-in is quiet where its written operands fit a line of the list that the table's generator makes of the overloads in front of the first that runs code.
// A call that fits a later line may bind an earlier overload. So the list goes on past an overload whose operands cannot be written only where no function and no object fits it.
import { expect, test } from "bun:test";
import { listQuietCalls } from "../../../src/codegen/builtins/emit-rust-table.ts";

type Overload = Parameters<typeof listQuietCalls>[0][number];
type Parameter = Overload["parameters"][number];
type Type = Parameter["accepted"];

const type = (fields: Partial<Type> = {}): Type => ({
  id: 0,
  key: "",
  isAnything: false,
  isMadeOfListedClasses: false,
  hasAnyObject: false,
  hasAnyFunction: false,
  hasPlainData: false,
  primitives: [],
  integers: null,
  stringLiterals: [],
  freshness: "No",
  parts: [],
  ...fields,
});
const takes = (accepted: Type, fields: Partial<Parameter> = {}): Parameter => ({
  mode: "Required",
  accepted,
  conversion: "None",
  refused: type(),
  ...fields,
});
const overload = (...parameters: Parameter[]): Overload => ({
  mode: "Call",
  effects: { capability: "heap" } as Overload["effects"],
  receiver: null,
  flags: [],
  flow: { transfers: [], callbacks: [], propertyActions: [], handlerCalls: [] },
  parameters,
  result: { type: type({ primitives: ["Undefined"] }) },
});

const text = type({ primitives: ["String"] });
const notPassed = type({ primitives: ["NotPassed"] });
const anything = type({ isAnything: true });
const written = (overloads: Overload[]) => listQuietCalls(overloads).map(({ operands }) => operands);

const functionAlone = overload(takes(type({ hasAnyFunction: true })));
const whateverFollows = overload(takes(anything, { mode: "Rest" }));

test("an overload of primitives alone gets no line and the list goes on", () => {
  expect(written([overload(takes(text), takes(notPassed)), whateverFollows])).toEqual([["WrittenOperand::AnyFurther"]]);
  expect(written([overload(takes(text)), functionAlone])).toEqual([["WrittenOperand::Function"]]);
});

test("an overload without a line that an object or a function fits ends the list", () => {
  expect(written([overload(takes(type({ primitives: ["String"], hasAnyObject: true }))), functionAlone])).toEqual([]);
  expect(written([overload(takes(type({ primitives: ["String"], hasAnyFunction: true }))), functionAlone])).toEqual([]);
  expect(written([overload(takes(type({ hasPlainData: true }))), whateverFollows])).toEqual([]);
});

test("a parameter that converts what it is handed ends the list: an object fits it and its code runs", () => {
  const loose = takes(text, { conversion: "ToString" });
  expect(written([overload(loose), whateverFollows])).toEqual([]);
});

test("an overload that stands in front for its door is passed over, and behind it no line that an object fits is listed", () => {
  const door = {
    ...overload(takes(anything, { mode: "Optional" }), takes(notPassed)),
    effects: { capability: "js" } as Overload["effects"],
    flags: ["RunsOnlyOperandCode"] as Overload["flags"],
    code: { directEntry: {} } as Overload["code"],
  };
  const primitives = overload(takes(text, { mode: "Rest" }));
  const runsCode = { ...whateverFollows, effects: { capability: "js" } as Overload["effects"] };
  const line = "WrittenOperand::PrimitivesFurther { null: false, boolean: false, number: false, string: true }";
  expect(written([door, primitives, runsCode])).toEqual([[line]]);
  expect(written([{ ...door, code: undefined }, primitives, runsCode])).toEqual([]);
  expect(written([{ ...door, flags: [] }, primitives, runsCode])).toEqual([]);
  // Nothing behind it takes whatever it takes.
  expect(written([door, primitives])).toEqual([]);
  expect(written([door, whateverFollows])).toEqual([]);
  expect(written([door, functionAlone, runsCode])).toEqual([]);
});

test("what speaks of the overload itself ends the list as ever", () => {
  expect(written([{ ...overload(takes(text)), flags: ["IsUndeclared"] }, whateverFollows])).toEqual([]);
  expect(
    written([{ ...overload(takes(text)), receiver: takes(anything) as Overload["receiver"] }, whateverFollows]),
  ).toEqual([]);
  expect(
    written([{ ...overload(takes(text)), effects: { capability: "js" } as Overload["effects"] }, whateverFollows]),
  ).toEqual([]);
});
