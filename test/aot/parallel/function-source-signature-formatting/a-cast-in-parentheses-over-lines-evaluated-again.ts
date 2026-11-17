// @ts-nocheck
type Wide = unknown;
enum Shade { Dark = 1 }
const enum Tone { Low = 2 }
const seven = 7;
const forms: Function[] = [
  function returned(element) { return (
    element as unknown as Wide
  ); },
  function returnedBehindAComment(element) { return ( // the element
    element as Wide); },
  function returnedBehindABlock(element) { return ( /* the
    element */ element as Wide); },
  function returnedNotNull(element) { return (
    element!
  ); },
  function returnedMember(element) { return (
    element.length satisfies Wide
  ); },
  function thrown(element) { try { throw (
    element as Wide
  ); } catch (caught) { return caught; } },
  function* yielded(element) { yield (
    element as Wide
  ); },
  function counted(element) { let count = element; (
    count as number
  )++; return count; },
  (element) => (
    element as Wide
  ),
  async (element) => await (
    element as Wide
  ),
  function onOneLine(element) { return (element as Wide); },
  function member(element) { return (element as Wide).length; },
  function called(element) { return (String as Wide)(element); },
  function calledOnItsHolder(element) { return (element.toString as Wide)(); },
  function made(element) { return new (Array as Wide)(element).length; },
  function tagged(element) { return (String.raw as Wide)`${element}`; },
  function literalFirst(element) { ({ element } as Wide); return element; },
  function functionFirst(element) { return (function () { return element; } as Wide)(); },
  function wordsApart(element) { return typeof(element as Wide); },
  function wordsApartInFrontOfAMember(element) { return typeof(element as Wide).length; },
  function behindACastInFront(element) { return<Wide>(element as Wide); },
  function behindACastInFrontOfAMember(element) { return<Wide>(element as Wide).length; },
  function behindAWordAndACastInFront(element) { return typeof<Wide>(element as Wide).length; },
  function behindAnArrow(element) { return (() =>(element as Wide).length)(); },
  function greater(element) { return 9 >(element as Wide).length; },
  function memberOfAnEnum(element) { return (Shade.Dark as number).toFixed(1) + element; },
  function memberOfAnEnumThatIsThere(element) { return (Shade.Dark!).toFixed(1) + element; },
  function memberOfAConstantEnum(element) { return (Tone.Low as number).toFixed(1) + element; },
  function constantOfTheFile(element) { return (seven as number).toFixed(1) + element; },
  function namedAsync(element) { let async; for ((async as Wide) of [element]); return async; },
  function namedLet(element) { var let_ = [element]; return (let_ as Wide)[0]; },
  function memberOnTheNextLine(element) { return (element as Wide)
    .length; },
  function memberBehindAComment(element) { return (element as Wide) /* its */ .length; },
  function optionalMember(element) { return (element as Wide)?.length; },
  function optionalCall(element) { return (element.toString as Wide)?.(); },
  function chainInside(element) { return (element?.nothing as Wide)?.length; },
  function stored(element) { let kept; (kept as Wide) = element; return kept; },
  function storedMember(element) { const holder = { kept: 0 }; (holder as Wide).kept = element; return holder.kept; },
  function madeOfAMember(element) { const holder = { Made: Array }; return new (holder as Wide).Made(element).length; },
  function negative(element) { return -(element as number) - -(element as number); },
  function divided(element) { return (element as number) / 2 / (element as number); },
  function inATemplate(element) { return `${(element as Wide)}${(element as Wide).length}`; },
  function extended(element) { class Below extends (Array as Wide) {} return new Below(element).length; },
];
for (const form of forms) {
  const again = new Function("Shade", "seven", "return (" + String(form) + ")")(Shade, seven);
  for (const element of [7, "seven"]) {
    let first = form(element), second = again(element);
    if (first && typeof first.next === "function") [first, second] = [first.next().value, second.next().value];
    console.log(form.name || "arrow", await first, await second);
  }
}
