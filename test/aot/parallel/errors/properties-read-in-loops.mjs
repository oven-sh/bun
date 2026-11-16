// Properties read off errors in loops: own, inherited and absent ones, values that are no strings, getters, and changes between two turns.
let calls = 0;
const lines = [];
class Mine extends Error { constructor(message, options) { super(message, options); this.name = "Mine"; } }
class WithGetter extends Error { get message() { calls++; return "getter"; } }
const attempt = read => { try { return String(read()); } catch (error) { return error.constructor.name; } };
const plain = new Error("first");
function plain0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.messagplain.length; return total; }
function plain1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.namplain.length; return total; }
function plain2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.causplain.messagplain.length; return total; }
function plain3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.causplain.length; return total; }
function plain4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.codplain.length; return total; }
function plain5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.message + plain.name; return total; }
function plain6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (plain.message ?? "none").length; return total; }
function plain7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += plain.message[0]; return total; }
function plain8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof plain.cause; return total; }
function allplain() { for (const read of [plain0, plain1, plain2, plain3, plain4, plain5, plain6, plain7, plain8]) lines.push("plain " + attempt(() => read(3))); }
const typed = new TypeError("second one");
function typed0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.messagtyped.length; return total; }
function typed1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.namtyped.length; return total; }
function typed2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.caustyped.messagtyped.length; return total; }
function typed3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.caustyped.length; return total; }
function typed4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.codtyped.length; return total; }
function typed5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.message + typed.name; return total; }
function typed6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (typed.message ?? "none").length; return total; }
function typed7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typed.message[0]; return total; }
function typed8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof typed.cause; return total; }
function alltyped() { for (const read of [typed0, typed1, typed2, typed3, typed4, typed5, typed6, typed7, typed8]) lines.push("typed " + attempt(() => read(3))); }
const bare = new RangeError();
function bare0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.messagbare.length; return total; }
function bare1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.nambare.length; return total; }
function bare2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.causbare.messagbare.length; return total; }
function bare3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.causbare.length; return total; }
function bare4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.codbare.length; return total; }
function bare5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.message + bare.name; return total; }
function bare6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (bare.message ?? "none").length; return total; }
function bare7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += bare.message[0]; return total; }
function bare8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof bare.cause; return total; }
function allbare() { for (const read of [bare0, bare1, bare2, bare3, bare4, bare5, bare6, bare7, bare8]) lines.push("bare " + attempt(() => read(3))); }
const caused = new Error("c", { cause: new TypeError("inner") });
function caused0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.messagcaused.length; return total; }
function caused1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.namcaused.length; return total; }
function caused2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.causcaused.messagcaused.length; return total; }
function caused3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.causcaused.length; return total; }
function caused4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.codcaused.length; return total; }
function caused5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.message + caused.name; return total; }
function caused6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (caused.message ?? "none").length; return total; }
function caused7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += caused.message[0]; return total; }
function caused8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof caused.cause; return total; }
function allcaused() { for (const read of [caused0, caused1, caused2, caused3, caused4, caused5, caused6, caused7, caused8]) lines.push("caused " + attempt(() => read(3))); }
const causeText = new Error("c", { cause: "text" });
function causeText0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.messagcauseText.length; return total; }
function causeText1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.namcauseText.length; return total; }
function causeText2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.causcauseText.messagcauseText.length; return total; }
function causeText3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.causcauseText.length; return total; }
function causeText4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.codcauseText.length; return total; }
function causeText5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.message + causeText.name; return total; }
function causeText6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (causeText.message ?? "none").length; return total; }
function causeText7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeText.message[0]; return total; }
function causeText8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof causeText.cause; return total; }
function allcauseText() { for (const read of [causeText0, causeText1, causeText2, causeText3, causeText4, causeText5, causeText6, causeText7, causeText8]) lines.push("causeText " + attempt(() => read(3))); }
const causeList = new Error("c", { cause: [1, 2, 3] });
function causeList0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.messagcauseList.length; return total; }
function causeList1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.namcauseList.length; return total; }
function causeList2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.causcauseList.messagcauseList.length; return total; }
function causeList3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.causcauseList.length; return total; }
function causeList4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.codcauseList.length; return total; }
function causeList5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.message + causeList.name; return total; }
function causeList6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (causeList.message ?? "none").length; return total; }
function causeList7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += causeList.message[0]; return total; }
function causeList8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof causeList.cause; return total; }
function allcauseList() { for (const read of [causeList0, causeList1, causeList2, causeList3, causeList4, causeList5, causeList6, causeList7, causeList8]) lines.push("causeList " + attempt(() => read(3))); }
const coded = Object.assign(new Error("m"), { code: "ENOENT" });
function coded0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.messagcoded.length; return total; }
function coded1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.namcoded.length; return total; }
function coded2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.causcoded.messagcoded.length; return total; }
function coded3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.causcoded.length; return total; }
function coded4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.codcoded.length; return total; }
function coded5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.message + coded.name; return total; }
function coded6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (coded.message ?? "none").length; return total; }
function coded7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += coded.message[0]; return total; }
function coded8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof coded.cause; return total; }
function allcoded() { for (const read of [coded0, coded1, coded2, coded3, coded4, coded5, coded6, coded7, coded8]) lines.push("coded " + attempt(() => read(3))); }
const codeNumber = Object.assign(new TypeError("t"), { code: 5 });
function codeNumber0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.messagcodeNumber.length; return total; }
function codeNumber1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.namcodeNumber.length; return total; }
function codeNumber2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.causcodeNumber.messagcodeNumber.length; return total; }
function codeNumber3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.causcodeNumber.length; return total; }
function codeNumber4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.codcodeNumber.length; return total; }
function codeNumber5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.message + codeNumber.name; return total; }
function codeNumber6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (codeNumber.message ?? "none").length; return total; }
function codeNumber7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += codeNumber.message[0]; return total; }
function codeNumber8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof codeNumber.cause; return total; }
function allcodeNumber() { for (const read of [codeNumber0, codeNumber1, codeNumber2, codeNumber3, codeNumber4, codeNumber5, codeNumber6, codeNumber7, codeNumber8]) lines.push("codeNumber " + attempt(() => read(3))); }
const messageNumber = Object.assign(new Error("x"), { message: 12 });
function messageNumber0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.messagmessageNumber.length; return total; }
function messageNumber1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.nammessageNumber.length; return total; }
function messageNumber2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.causmessageNumber.messagmessageNumber.length; return total; }
function messageNumber3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.causmessageNumber.length; return total; }
function messageNumber4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.codmessageNumber.length; return total; }
function messageNumber5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.message + messageNumber.name; return total; }
function messageNumber6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (messageNumber.message ?? "none").length; return total; }
function messageNumber7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageNumber.message[0]; return total; }
function messageNumber8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof messageNumber.cause; return total; }
function allmessageNumber() { for (const read of [messageNumber0, messageNumber1, messageNumber2, messageNumber3, messageNumber4, messageNumber5, messageNumber6, messageNumber7, messageNumber8]) lines.push("messageNumber " + attempt(() => read(3))); }
const messageList = Object.assign(new Error("x"), { message: ["l", "i", "s", "t"] });
function messageList0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.messagmessageList.length; return total; }
function messageList1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.nammessageList.length; return total; }
function messageList2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.causmessageList.messagmessageList.length; return total; }
function messageList3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.causmessageList.length; return total; }
function messageList4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.codmessageList.length; return total; }
function messageList5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.message + messageList.name; return total; }
function messageList6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (messageList.message ?? "none").length; return total; }
function messageList7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += messageList.message[0]; return total; }
function messageList8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof messageList.cause; return total; }
function allmessageList() { for (const read of [messageList0, messageList1, messageList2, messageList3, messageList4, messageList5, messageList6, messageList7, messageList8]) lines.push("messageList " + attempt(() => read(3))); }
const named = Object.assign(new Error("x"), { name: "Named" });
function named0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.messagnamed.length; return total; }
function named1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.namnamed.length; return total; }
function named2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.causnamed.messagnamed.length; return total; }
function named3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.causnamed.length; return total; }
function named4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.codnamed.length; return total; }
function named5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.message + named.name; return total; }
function named6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (named.message ?? "none").length; return total; }
function named7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += named.message[0]; return total; }
function named8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof named.cause; return total; }
function allnamed() { for (const read of [named0, named1, named2, named3, named4, named5, named6, named7, named8]) lines.push("named " + attempt(() => read(3))); }
const nameList = Object.assign(new Error("x"), { name: [1] });
function nameList0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.messagnameList.length; return total; }
function nameList1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.namnameList.length; return total; }
function nameList2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.causnameList.messagnameList.length; return total; }
function nameList3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.causnameList.length; return total; }
function nameList4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.codnameList.length; return total; }
function nameList5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.message + nameList.name; return total; }
function nameList6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (nameList.message ?? "none").length; return total; }
function nameList7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += nameList.message[0]; return total; }
function nameList8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof nameList.cause; return total; }
function allnameList() { for (const read of [nameList0, nameList1, nameList2, nameList3, nameList4, nameList5, nameList6, nameList7, nameList8]) lines.push("nameList " + attempt(() => read(3))); }
const getter = Object.defineProperty(new Error("d"), "message", { get() { calls++; return "got"; }, configurable: true });
function getter0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.messaggetter.length; return total; }
function getter1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.namgetter.length; return total; }
function getter2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.causgetter.messaggetter.length; return total; }
function getter3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.causgetter.length; return total; }
function getter4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.codgetter.length; return total; }
function getter5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.message + getter.name; return total; }
function getter6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (getter.message ?? "none").length; return total; }
function getter7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += getter.message[0]; return total; }
function getter8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof getter.cause; return total; }
function allgetter() { for (const read of [getter0, getter1, getter2, getter3, getter4, getter5, getter6, getter7, getter8]) lines.push("getter " + attempt(() => read(3))); }
const own = new Mine("mine", { cause: new Mine("deeper") });
function own0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.messagown.length; return total; }
function own1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.namown.length; return total; }
function own2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.causown.messagown.length; return total; }
function own3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.causown.length; return total; }
function own4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.codown.length; return total; }
function own5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.message + own.name; return total; }
function own6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (own.message ?? "none").length; return total; }
function own7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += own.message[0]; return total; }
function own8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof own.cause; return total; }
function allown() { for (const read of [own0, own1, own2, own3, own4, own5, own6, own7, own8]) lines.push("own " + attempt(() => read(3))); }
const below = new WithGetter("g");
function below0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.messagbelow.length; return total; }
function below1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.nambelow.length; return total; }
function below2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.causbelow.messagbelow.length; return total; }
function below3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.causbelow.length; return total; }
function below4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.codbelow.length; return total; }
function below5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.message + below.name; return total; }
function below6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (below.message ?? "none").length; return total; }
function below7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += below.message[0]; return total; }
function below8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof below.cause; return total; }
function allbelow() { for (const read of [below0, below1, below2, below3, below4, below5, below6, below7, below8]) lines.push("below " + attempt(() => read(3))); }
const gone = (() => { const e = new Error("gone"); delete e.message; return e; })();
function gone0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.messaggone.length; return total; }
function gone1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.namgone.length; return total; }
function gone2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.causgone.messaggone.length; return total; }
function gone3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.causgone.length; return total; }
function gone4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.codgone.length; return total; }
function gone5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.message + gone.name; return total; }
function gone6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (gone.message ?? "none").length; return total; }
function gone7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += gone.message[0]; return total; }
function gone8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof gone.cause; return total; }
function allgone() { for (const read of [gone0, gone1, gone2, gone3, gone4, gone5, gone6, gone7, gone8]) lines.push("gone " + attempt(() => read(3))); }
const many = new AggregateError([new Error("a"), 5], "many");
function many0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.messagmany.length; return total; }
function many1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.nammany.length; return total; }
function many2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.causmany.messagmany.length; return total; }
function many3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.causmany.length; return total; }
function many4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.codmany.length; return total; }
function many5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.message + many.name; return total; }
function many6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (many.message ?? "none").length; return total; }
function many7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += many.message[0]; return total; }
function many8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof many.cause; return total; }
function allmany() { for (const read of [many0, many1, many2, many3, many4, many5, many6, many7, many8]) lines.push("many " + attempt(() => read(3))); }
const orphan = Object.setPrototypeOf(new Error("p"), null);
function orphan0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.messagorphan.length; return total; }
function orphan1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.namorphan.length; return total; }
function orphan2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.causorphan.messagorphan.length; return total; }
function orphan3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.causorphan.length; return total; }
function orphan4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.codorphan.length; return total; }
function orphan5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.message + orphan.name; return total; }
function orphan6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (orphan.message ?? "none").length; return total; }
function orphan7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += orphan.message[0]; return total; }
function orphan8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof orphan.cause; return total; }
function allorphan() { for (const read of [orphan0, orphan1, orphan2, orphan3, orphan4, orphan5, orphan6, orphan7, orphan8]) lines.push("orphan " + attempt(() => read(3))); }
const frozen = Object.freeze(new Error("frozen"));
function frozen0(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.messagfrozen.length; return total; }
function frozen1(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.namfrozen.length; return total; }
function frozen2(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.causfrozen.messagfrozen.length; return total; }
function frozen3(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.causfrozen.length; return total; }
function frozen4(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.codfrozen.length; return total; }
function frozen5(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.message + frozen.name; return total; }
function frozen6(turns) { let total = 0; for (let i = 0; i < turns; i++) total += (frozen.message ?? "none").length; return total; }
function frozen7(turns) { let total = 0; for (let i = 0; i < turns; i++) total += frozen.message[0]; return total; }
function frozen8(turns) { let total = 0; for (let i = 0; i < turns; i++) total += typeof frozen.cause; return total; }
function allfrozen() { for (const read of [frozen0, frozen1, frozen2, frozen3, frozen4, frozen5, frozen6, frozen7, frozen8]) lines.push("frozen " + attempt(() => read(3))); }
function kinds(list, turns) { let total = 0; for (let i = 0; i < turns; i++) { const e = list[i % list.length]; total += e.message.length + e.name.length; if (i === 5) list[0].message = [1, 2]; if (i === 9) list[1].name = "Other"; if (i === 12) list[2] = { message: "no error", name: { length: 2 } }; } return total; }
function changes(turns) { const e = new Error("start"); let total = ""; for (let i = 0; i < turns; i++) { total += e.message.length; if (i === 2) e.message = "longer than before"; if (i === 4) e.message = 7; if (i === 6) delete e.message; if (i === 8) e.message = [1]; } return total; }
for (let turn = 0; turn < 2; turn++) {
  allplain();
  alltyped();
  allbare();
  allcaused();
  allcauseText();
  allcauseList();
  allcoded();
  allcodeNumber();
  allmessageNumber();
  allmessageList();
  allnamed();
  allnameList();
  allgetter();
  allown();
  allbelow();
  allgone();
  allmany();
  allorphan();
  allfrozen();
  lines.push(attempt(() => kinds([new Error("a"), new TypeError("bb"), new RangeError("ccc")], 20)), attempt(() => changes(11)));
  if (turn === 0) { Object.defineProperty(Mine.prototype, "code", { get() { calls++; return "above"; }, configurable: true }); Object.defineProperty(WithGetter.prototype, "message", { value: [1, 2, 3] }); own.name = ["Re", "named"]; delete own.message; }
}
for (const line of lines) console.log(line);
console.log(calls);
