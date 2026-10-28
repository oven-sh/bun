export enum Length {
  Plain = "xyz".length,
  OneMore = Plain + 1,
  InBrackets = "a\u{1F600}b"["length"],
  OfJoinedTexts = ("ab" + "cd").length << 1,
  OfTemplate = `xy`.length,
  InChain = "q"?.length,
  OfNothing = "".length,
  OneMoreThanNothing = OfNothing + 1,
}
