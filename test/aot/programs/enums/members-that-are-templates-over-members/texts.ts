export enum Text {
  One = 1,
  Name = "name",
  Both = `a${One}b${Name}c`,
  OfMember = `${Text.Both}!`,
  InBrackets = `<${Text["Name"]}>`,
  Plain = `plain`,
  Computed = `n${1 + 3 - (4 / 2) * 5 ** 2}`,
  Negative = `${-One}|${~One}`,
  Joined = `x${One}` + Name,
}

export const enum Constant {
  A = 123,
  B = `a${A}b`,
  C = `${Constant.B}${Constant["A"]}`,
}
