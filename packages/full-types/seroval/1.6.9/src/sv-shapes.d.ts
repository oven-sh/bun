// sv-shapes.d.ts: the shapes of seroval 1.6.9, dist/index.js. READ OFF THE BUNDLE'S OWN BIRTHS AND STORES; the authors' declaration file tells what is meant.
// "birth NNNN" = line of original.js (the line of the literal's `{`). "given" = the value is made elsewhere (the user, a plugin, JSON.parse, the engine).
// THE MEMBERS OF AN INTERFACE STAND IN THE ORDER OF THE BIRTH'S LITERAL. WHERE TWO OR MORE UNLIKE LITERALS GO INTO ONE PARAMETER (S7 forbids the union) THEY ARE
//   ONE INTERFACE, ONE LAYOUT: what one of the births lacks is an OPTIONAL member: ParserContext DeserializerContext ParserOptions SerializerOptions DeserializerOptions.
// CHECKED BY PROGRAM: python3 shapes_check.py: (1) THE CHECKER DOES NOT LOOK INTO A .d.ts (a name that does not exist there is silently any): all sv-shapes*.d.ts are
//   checked as .ts (2) the births named behind the heads have their interface's members (3) sections A B C below, APPLIED to original.js, leave no error at a head.
// PROVED: trial/typed-trial.mts.txt: the whole bundle under these shapes: 0 errors, verify PASS: sections A B C (344 lines), 135 `!`, 60 casts, 12 locals. A PROOF, NOT THE TEXT: its casts
//   stand between no markers and rule 2's locals are not done.
// FOR AN ANNOTATOR, FIRST OF ALL: python3 shapes_check.py apply NN : writes sections A B C into parts/NN.mts (1,029 errors -> 241 over the 7 pieces). What is left is inside the bodies.
// SECTIONS BEHIND THE NAMESPACE: A the module's variables · B the classes' fields · C EVERY FUNCTION'S HEAD, TO BE COPIED · D births without an interface · E THE BORDER · F idioms.
declare namespace SV {
  // -------------------------------------------------------------------------------------------------------------------
  // 1. Numbers. int32: four bytes and integer arithmetic; the build proves every value that is stored there, or stops.
  // -------------------------------------------------------------------------------------------------------------------
  type int32 = import("bun").int32;
  type NodeType = int32; // SerovalNode.t: 0 Number 1 String 2 Constant 3 BigInt 4 IndexedValue 5 Date 6 RegExp 7 Set 8 Map 9 Array 10 Object 11 NullConstructor 12 Promise 13 Error 14 AggregateError 15 TypedArray 16 BigIntTypedArray 17 WKSymbol 18 Reference 19 ArrayBuffer 20 DataView 21 Boxed 22 PromiseConstructor 23 PromiseSuccess 24 PromiseFailure 25 Plugin 26 SpecialReference 27 IteratorFactory 28 IteratorFactoryInstance 29 AsyncIteratorFactory 30 AsyncIteratorFactoryInstance 31 StreamConstructor 32 StreamNext 33 StreamThrow 34 StreamReturn 35 Sequence 36 Temporal
  type RefId = number; // SerovalNode.i, every `id` of the parser and the serializer: refs.size at the moment the value is first met (921)
  type Mode = int32; // 1 Vanilla 2 Cross
  type ParserType = int32; // ParserContext.type: 1 Sync 2 Stream
  type Features = number; // bits: 1 AggregateError 2 ArrowFunction 4 ErrorPrototypeStack 8 ObjectAssign 16 BigIntTypedArray 32 RegExp 64 Temporal. Made by ^ & ~ alone (901 1339 3091)
  type Depth = number; // every `depth`: 0, + 1 an object
  type ObjectFlag = number; // SerovalNode.o, FlaggedObject.type: 0 None 1 NonExtensible 2 Sealed 3 Frozen
  type ConstantTag = int32; // s at t 2: 0 null 1 undefined 2 true 3 false 4 -0 5 Infinity 6 -Infinity 7 NaN
  type SymbolTag = int32; // s at t 17: 0..12: the key of SYMBOL_STRING | SYMBOL_REF
  type ErrorTag = int32; // s at t 13 14: 0 Error 1 EvalError 2 RangeError 3 ReferenceError 4 SyntaxError 5 TypeError 6 URIError
  type SpecialRef = int32; // s at t 26: 0 MapSentinel 1 PromiseConstructor 2 PromiseSuccess 3 PromiseFailure 4 StreamConstructor 5 ArrayBufferConstructor
  type TemporalType = int32; // c at t 36: 0 Instant 1 Duration 2 PlainDate 3 PlainDateTime 4 PlainMonthDay 5 PlainTime 6 PlainYearMonth 7 ZonedDateTime
  type PromiseStatus = int32; // s at t 12: 1 fulfilled 0 rejected
  type SequenceIndex = number; // Sequence.t | .d, s and l at t 35: -1 = never
  type NodeLength = int32; // SerovalNode.l: a view's length | byteLength (at most 1e6: 436 440 444 throw beyond) · at t 35 a SequenceIndex
  type AssignmentType = int32; // Assignment.t: 0 Index 1 Add 2 Set 3 Delete 4 Define
  type RefKind = int32; // ParsedRef.type: 0 Fresh 1 Indexed 2 Referenced
  type Count = number; // StreamParserState.pending, Stream.count, Serializer.pending | .ids, an index into vars
  type DepthLimit = number; // options.depthLimit || 1000: THE USER'S NUMBER: NOT int32 (Infinity is a sensible one). The authors' type says number
  type ByteOffset = number; // SerovalNode.b: a view's byteOffset into THE USER'S BUFFER: NOT int32
  type Base64Limit = number; // maxBase64Length: any safe integer >= 0 gets through 1332: NOT int32

  // -------------------------------------------------------------------------------------------------------------------
  // GIVEN (section 2): what other code makes: `any` under a name. NEVER PUT ONE OF THESE IN A UNION: T | any IS any, silently.
  //    Where such a member or variable may hold undefined the comment says so; the type does not.
  // -------------------------------------------------------------------------------------------------------------------
  type Given = any; // the value to be serialized and everything reached from it: source current value item data properties obj iterable error (the one to be parsed) ref
  type GivenClass = any; // current.constructor | its prototype's: currentClass. undefined when none
  type GivenString = any; // a string by the authors' type that other code hands in and the bundle itself does not trust: deserializeString tests typeof (199); plugin.tag; a given node's c; what eval is handed (3047)
  type GivenFlag = any; // options.compactArrayBufferViews: boolean | undefined by the authors' type; only ever tested for truth (985)
  type GivenNumber = any; // options.disabledFeatures | features | depthLimit | maxBase64Length: number | undefined by the authors' type; operands of || ?? ^ & ~, or tested (1332)
  type ScopeId = any; // options.scopeId, getCrossReferenceHeader's id: string | undefined: compared == null, then serializeString
  type Options = any; // the bag a public function or `new Serializer` is handed (also {} by default, and the literal of 2965)
  type Plugin = any; // tag extends test parse { sync async stream } serialize deserialize: createPlugin (1254) hands back what it is given. READ BY NAME FOR EVERY OBJECT PARSED
  type PluginInfo = any; // what plugin.parse.sync | async | stream gives: kept in s at t 25, handed back to plugin.serialize | deserialize, never looked into here
  type OnParse = any; // (node: SerovalNode, initial: boolean) => void: the user's (2928) or the method born at 2898
  type OnError = any; // (error) => void: the user's. undefined when none
  type OnDone = any; // () => void: the user's, or the arrow of 2975. undefined when none
  type Thrown = any; // what a catch clause holds, a rejection's reason, an error's cause
  type StreamListener = any; // { next, throw, return }: born 620 1109 2622 OR THE USER'S | A PLUGIN'S (Stream.on is public): read by a computed name (787 793). undefined in Stream.listeners where one left
  type Deserialized = any; // what deserialization builds and hands back, and what lies in the deserializer's refs
  interface MadeObject { [key: string]: any } // `{}` or `Object.create(null)` that deserializeObject has just made: applyObjectFlag freezes it, or an array. Were its parameter `any`, the compiler would have to take every layout of the program for one that may be frozen, and every store to a field would ask
  type GivenRefs = any; // compileJSON's | fromJSON's source.m
  type GivenNode = any; // A NODE THAT CAME IN FROM OUTSIDE: born here once, or what JSON.parse made of one (2 to 6 of the 12 members: JSON drops undefined), or garbage. SECTION E
  type GivenRecord = any; // a given node's p | e: { k, v }
  type GivenId = any; // a given node's i (| s at t 22): guardIndexedValue (1368) lets every integer >= 0 through, also beyond int32
  type GivenJSON = any; // compileJSON's and fromJSON's source: { t, f, m }: a SerovalJSON born here or what JSON.parse made of one; f may be missing (3086)
  type ExportedNode = any; // toCrossJSON's | toCrossJSONAsync's result: a SerovalNode born here. NOT WRITTEN AS SerovalNode: a record type in the result of a function that JavaScript imports, or that a JavaScript entry exports again, counts as data from outside: the type loses its layout in the WHOLE program: nodes are made as plain objects and every node.t is read by name
  type ExportedJSON = any; // toJSON's | toJSONAsync's result: a SerovalJSON born here: as ExportedNode

  // -------------------------------------------------------------------------------------------------------------------
  // 3. Dictionaries, tables, tuples, functions, what is only carried
  // -------------------------------------------------------------------------------------------------------------------
  // TABLES: literals whose keys are computed ([0]: ..): read by a computed key alone: plain objects, no layout.
  type StringTable = { [tag: number]: string }; // births 34 79 99 755 2141
  type FlagTable = { [flag: number]: string | undefined }; // birth 1812
  type SymbolTable = { [tag: number]: symbol }; // birth 64
  type SymbolTags = { [key: symbol]: SymbolTag }; // birth 49
  type KnownValues = { [tag: number]: any }; // births 89 108, and 64 where it is deserializeKnownValue's record
  type TokenTable = { [ref: number]: {} }; // birth 747: six {} that stand for the special references as keys of refs
  type StepCodes = { [step: string]: int32 }; // birth 205
  type EnumTable = { [name: string]: string | number }; // births 16 1253: the {} that Feature | SerovalMode are built on: name -> number and number -> name
  type ErrorOptions = { [name: string]: Given }; // births 358 359 360 370 374: { name } | {}: members are ADDED behind the birth by a computed name (371 375); goes on as parseProperties' `properties`
  type Plugins = Plugin[]; // birth 1270: the array is born here, what is in it is given; also what the user hands resolvePlugins
  type ParserRefs = Map<Given, RefId>; // birth 902 2956, OR THE USER'S Map (options.refs): a built-in either way
  type DeserializerRefs = Map<GivenId, Deserialized>; // birth 1333, or the user's. 1334 PUTS A MEMBER `types` ON IT (Object.assign): no augmentation of a built-in: 1438 1441 read it by rule 8's marked cast
  type NodeTypes = Map<GivenId, NodeType>; // birth 1334: what that `types` holds
  type MarkedRefs = Set<RefId> | RefId[]; // BaseParserContext.marked, or compileJSON's source.m (given): only ever the argument of new Set (1823)
  type PromiseResult = [status: PromiseStatus, value: Given]; // births 888 890
  type NodeItem = SerovalNode | 0; // an element of SerovalNode.a: 0 = a hole of an array (1021 2543). `if (item)` narrows it (2010)
  type RecordKey = string | SerovalNode; // an element of ObjectRecord.k: an escaped name, or the node of a well-known symbol. typeof === "string" narrows it (2040 2097)
  type Cleanup = () => void; // births 806 851 2918 2933, or a plugin's (2517)
  type Settle = (value: any) => void; // the resolve | reject of new Promise (496)
  type StreamEvent = "next" | "throw" | "return"; // Stream.flush's mode
  type NodeValue = unknown; // SerovalNode.s: see there
  type Carried = unknown; // a value that is only tested for nil, stored and handed on: no member is read off it here

  // -------------------------------------------------------------------------------------------------------------------
  // 4. THE NODE. createSerovalNode (119) IS THE ONE BIRTH: 36 callers, 37 kinds, ONE LAYOUT. No member is ever stored to again.
  //    A member narrower than this is a marked cast | a ! ON THE MEMBER'S VALUE: node.i! · node.f! · node.a![0]/*$*/ as SV.SerovalNode/*$*/ · never another shape.
  //    WHICH MEMBERS A KIND HAS (all others undefined):
  //      0 s · 1 s · 2 s · 3 s · 4 i · 5 i s · 6 i c m · 7 i a · 8 i e f · 9 i a o · 10 11 i p o · 12 i s f · 13 14 i s m p? · 15 16 i c f b l · 17 i s · 18 i s · 19 i s f · 20 i f b l · 21 i f
  //      22 i s f · 23 24 i a · 25 i s c · 26 i s · 27 i f · 28 30 a · 29 i a · 31 i a f · 32 33 34 i f · 35 i s a l · 36 i s c
  //    toJSON | toCrossJSON* | onParse HAND IT TO THE USER, who gives it to JSON.stringify: the order of the members is the order of the output.
  // -------------------------------------------------------------------------------------------------------------------
  interface SerovalNode { // birth 120. ELEVEN MEMBERS ARE OPTIONAL: born with all twelve; BUT A NODE THAT JSON CARRIED HAS 2 TO 6 OF THEM (JSON drops undefined) AND COMES IN AT THREE DOORS (compileJSON, the two plugin hooks): with the members required the engine REFUSED it ("property 'c' is missing in plain object but required in SerovalNode": 15 of 20 heads of the wide tree's doors program): A VALUE THAT SATISFIES ITS TYPE IS NEVER REFUSED: SO THE TYPE SAYS WHAT COMES.
    t: NodeType;
    i?: RefId | undefined;
    // s: number (ANY double) at t 0 · string at 1 3 5 18 19 36 · ConstantTag 2 · PromiseStatus 12 · ErrorTag 13 14 · SymbolTag 17 · RefId 22 (the resolver's) · SpecialRef 26 · SequenceIndex 35
    //    · AT t 25 WHAT THE PLUGIN GAVE (PluginInfo: anything at all: nothing keeps a plugin from giving a string, undefined or a SerovalNode itself). So the union of what the callers pass is `unknown`.
    //    THE BORN SIDE READS IT AT 16 PLACES, ALL IN THE SERIALIZER; 13 ARE CAST TO WHAT t SAYS (node.s as string | number | SV.ConstantTag ..), ALSO WHERE THE CHECKER ASKS FOR NONE ("" + unknown passes: section F).
    //    No cast: `node.s ? a : b` (2271 2275) · plugin.serialize(node.s, ..) (2309).
    s?: NodeValue;
    c?: string | TemporalType | undefined; // string: 6 the escaped source · 15 16 the constructor's name (given: current.constructor.name) · 25 the escaped tag. TemporalType: 36
    m?: string | undefined; // 6 the flags (given: current.flags) · 13 14 the escaped message
    p?: ObjectRecord | undefined;
    e?: MapRecord | undefined;
    a?: NodeItem[] | undefined; // 9: nodes and holes · 7 31 35: nodes · 23 24 28 29 30: a pair of nodes, born as a literal [x, y] (457 460 970 2649 2656)
    f?: SerovalNode | undefined;
    b?: ByteOffset | undefined;
    o?: ObjectFlag | undefined;
    l?: NodeLength | undefined;
  }
  /** TWO INTERFACES OF THE SAME TWO NAMES, ON PURPOSE: no function takes both, no value goes from one to the other, and a Map's keys are nodes alone */
  interface ObjectRecord { k: RecordKey[]; v: SerovalNode[] } // birth 1051 2573
  interface MapRecord { k: SerovalNode[]; v: SerovalNode[] } // birth 976

  // -------------------------------------------------------------------------------------------------------------------
  // 5. The parser's side
  // -------------------------------------------------------------------------------------------------------------------
  interface BaseParserContext { // birth 897
    plugins: Plugins | undefined;
    mode: Mode; // never read
    marked: Set<RefId>;
    features: Features;
    refs: ParserRefs;
    depthLimit: DepthLimit; // READ FOR EVERY VALUE PARSED (1222 2763)
    compactArrayBufferViews: GivenFlag; // false when none
  }
  // made for EVERY object, function and symbol parsed (getNodeForIndexedValue). The authors have three shapes told apart by `type`: ONE LAYOUT: ref.value/*$*/ as SV.RefId/*$*/ behind type 0, as SV.SerovalNode behind 1 | 2
  interface ParsedRef { type: RefKind; value: SerovalNode | RefId } // birth 929 934 942
  interface AsyncParserContext { base: BaseParserContext; child: undefined } // birth 1004: child is never stored again, never read
  /**
   * THE AUTHORS' SyncParserContext (2476: type 1, child) AND StreamParserContext (2534: type 2, state): parseSOS and all it calls take both: ONE INTERFACE.
   * state is there exactly where type is 2: ctx.state! (`bang` puts it). Behind `ctx.type === 1 ? .. : ..` and in every function that only a stream reaches.
   */
  interface ParserContext { // birth 2476 2534
    type: ParserType;
    base: BaseParserContext;
    child?: undefined; // never stored again, never read
    state?: StreamParserState;
  }
  interface StreamParserState { // birth 2522
    alive: boolean;
    pending: Count;
    initial: boolean;
    buffer: SerovalNode[];
    onParse: OnParse;
    onError: OnError; // undefined when none
    onDone: OnDone; // undefined when none
    cleanups: Cleanup[];
  }
  /**
   * The bags the public functions make for createSyncParserContext | createAsyncParserContext | createStreamParserContext. FOUR UNLIKE LITERALS, ONE PARAMETER (createBaseParserContext's): ONE INTERFACE.
   * 3020 3034 3051 3064 { compactArrayBufferViews, plugins, disabledFeatures } · 2843 2859 2875 2884 the same and refs BEHIND disabledFeatures (never enumerated: the order shows nowhere)
   * · 2893 (NOT IN births.txt: onParse is a method there) all but depthLimit · 2922 all eight. Dropped when the context is made.
   */
  interface ParserOptions { // birth 2843 2859 2875 2884 2893 2922 3020 3034 3051 3064
    compactArrayBufferViews: GivenFlag; // undefined when none
    plugins: Plugins | undefined;
    refs?: ParserRefs | undefined; // the user's Map
    disabledFeatures: GivenNumber; // undefined when none
    depthLimit?: GivenNumber;
    onParse?: OnParse;
    onError?: OnError;
    onDone?: OnDone;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 6. The serializer's side
  // -------------------------------------------------------------------------------------------------------------------
  /** the authors have five shapes told apart by t: THE SAME MEMBERS IN THE SAME ORDER: ONE LAYOUT. k: 2 3 4 · v: 0 1 2 */
  interface Assignment { t: AssignmentType; s: string; k: string | undefined; v: string | undefined } // birth 1766 1772 1778 1784 1931 1939 1947 1955 1967
  interface FlaggedObject { type: ObjectFlag; value: string } // birth 1902
  interface BaseSerializerContext { // birth 1819
    mode: Mode; // never read
    plugins: Plugins | undefined;
    features: GivenNumber; // GIVEN at 3078: compileJSON's source.f: missing | a string in a carried tree: npm's `x & 8` takes anything: an int32 field threw (the wide tree: "f a string", "no f")
    marked: Set<RefId>;
    stack: RefId[]; // swapped for a fresh [] and back (2101 2201 2216)
    flags: FlaggedObject[];
    assignments: Assignment[]; // swapped and back (2090 2105)
  }
  interface VanillaSerializerState { valid: Map<RefId, Count>; vars: string[] } // birth 1830
  /** THE AUTHORS' VanillaSerializerContext (1836) AND CrossSerializerContext (1844): the same members in the same order: ONE SHAPE */
  interface SerializerContext { // birth 1836 1844
    mode: Mode;
    base: BaseSerializerContext;
    state: SerializerState;
    child: Carried; // undefined, then (2308) a SerializePluginContext: A CLASS OF THE BUNDLE, WHICH AN AMBIENT FILE CANNOT NAME. Tested == null, stored, handed to the plugin: nothing is read off it
  }
  // THE ONE UNION OF TWO BORN SHAPES: the data model's, in a field: mode 1 the first, mode 2 the second (createCrossSerializerContext keeps its own options bag). ctx.state/*$*/ as SV.VanillaSerializerState/*$*/ (1891 2443 2452) · as SV.SerializerOptions (2463)
  type SerializerState = VanillaSerializerState | SerializerOptions;
  /** 2850 2866 2899 all four · 3026 3040 3076 without scopeId. 2899: ONE FOR EVERY NODE A STREAM EMITS */
  interface SerializerOptions { // birth 2850 2866 2899 3026 3040 3076
    plugins: Plugins | undefined;
    features: GivenNumber; // GIVEN at 3078
    scopeId?: ScopeId;
    markedRefs: GivenRefs; // GIVEN at 3079: compileJSON's source.m: `new Set(x)` takes what comes
  }

  // -------------------------------------------------------------------------------------------------------------------
  // 7. The deserializer's side: THE CONTEXTS ARE BORN HERE, THE NODES ARE GIVEN (section E)
  // -------------------------------------------------------------------------------------------------------------------
  interface BaseDeserializerContext { // birth 1335
    mode: Mode; // never read
    plugins: Plugins | undefined;
    refs: DeserializerRefs;
    features: Features; // (given at 2941: fromCrossJSON's options.features: the authors' type says number)
    depthLimit: DepthLimit;
    maxBase64Length: Base64Limit;
  }
  interface VanillaDeserializerState { marked: Set<GivenId> } // birth 1349
  /** THE AUTHORS' VanillaDeserializerContext (1345: mode 1, state) AND CrossDeserializerContext (1353: mode 2, none): every deserialize* takes both: ONE INTERFACE. ctx.state! in assignIndexedValueVanilla alone */
  interface DeserializerContext { // birth 1345 1353
    mode: Mode;
    base: BaseDeserializerContext;
    child: undefined; // never stored again, never read
    state?: VanillaDeserializerState;
  }
  /** 2937 fromCrossJSON's: without markedRefs · 3087 fromJSON's: without refs and depthLimit */
  interface DeserializerOptions { // birth 2937 3087
    maxBase64Length: GivenNumber; // undefined when none
    plugins: Plugins | undefined;
    refs?: DeserializerRefs | undefined; // the user's Map
    markedRefs?: Given; // source.m
    features: GivenNumber; // undefined when none (2941); an int32 made here at 3091
    disabledFeatures: GivenNumber;
    depthLimit?: GivenNumber;
  }
  // BORN { p: 0, s: 0, f: 0 } AND FILLED AT ONCE (496..498): rule 5a's mine: `const resolver: SV.Deferred`. A call: /*$*/(/*$*/deferred.s/*$*/ as SV.Settle)/*$*/(x). Lies in DeserializerRefs (1580) and comes back as any (1585)
  interface Deferred { p: Promise<Deserialized> | 0; s: Settle | 0; f: Settle | 0 } // birth 491

  // -------------------------------------------------------------------------------------------------------------------
  // 8. What is handed to the user
  // -------------------------------------------------------------------------------------------------------------------
  interface SerovalJSON { t: SerovalNode; f: Features; m: RefId[] } // birth 3056 3069: toJSON's | toJSONAsync's result. WHAT COMES BACK IN IS GivenJSON
  interface IteratorStep { done: boolean; value: Given } // birth 592 599 615 623 639 660 665 671 676: next()'s result: checked only under a declared result (section C: 591 652) | what a pending promise is settled with (615 623 639: arguments of a Settle, any: leave them)
}

// ---------------------------------------------------------------------------------------------------------------------
// Globals the bundle names and the checker's library (ES only) lacks. Delete this block when a real library is in.
// ---------------------------------------------------------------------------------------------------------------------
declare var window: any;
declare var self: any;
declare var global: any;
declare var T: any;
declare var Buffer: { from(data: ArrayBuffer): { toString(encoding: string): string; write(text: string, encoding: string): number } };
declare function atob(data: string): string;
declare function btoa(data: string): string;

// ---------------------------------------------------------------------------------------------------------------------
// A. THE MODULE-LEVEL VARIABLES. Not listed = a symbol | number | string | regular expression | a node | the result of a call: leave it to inference.
//    (the 13 SYM_*, the 8 *_NODE: SV.SerovalNode by createConstantNode's result, the 7 SERIALIZED_*, createIterator, createAsyncIterable, ITERATOR and ASYNC_ITERATOR: {})
// ---------------------------------------------------------------------------------------------------------------------
//@var   34 SYMBOL_STRING: SV.StringTable
//@var   49 INV_SYMBOL_REF: SV.SymbolTags
//@var   64 SYMBOL_REF: SV.SymbolTable
//@var   79 CONSTANT_STRING: SV.StringTable
//@var   89 CONSTANT_VAL: SV.KnownValues
//@var   99 ERROR_CONSTRUCTOR_STRING: SV.StringTable
//@var  108 ERROR_CONSTRUCTOR: SV.KnownValues
//@var  205 STEP_ERROR_CODES: SV.StepCodes
//@var  300 REFERENCE: Map<SV.Given, string>
//@var  301 INV_REFERENCE: Map<string, SV.Given>
//@var  747 SPECIAL_REFS: SV.TokenTable
//@var  755 SPECIAL_REF_STRING: SV.StringTable
//@var 1812 OBJECT_FLAG_CONSTRUCTOR: SV.FlagTable
//@var 2141 TEMPORAL_CONSTRUCTOR: SV.StringTable

// ---------------------------------------------------------------------------------------------------------------------
// B. THE CLASSES. `var X = class { .. }` DECLARES A VALUE ALONE: THE TYPE OF ITS INSTANCES IS WRITTEN InstanceType<typeof X> (probed: it is the class's own type; typeof X may stand ahead of the var).
//    The fields, in the order the constructor stores them, by rule 1: `var X = class { /*$*/a: T; b: U;/*$*/` on the line of the `{`.
// ---------------------------------------------------------------------------------------------------------------------
//@class  238 SerovalUnsupportedTypeError { value: SV.Given; }
//@class  259 SerovalMissingReferenceError { value: SV.Given; }
//@class  482 OpaqueReference { value: SV.Given; replacement: SV.Given; }
//@class  703 Sequence { v: SV.Given[]; t: SV.SequenceIndex; d: SV.SequenceIndex; }
//@class  776 Stream { buffer: SV.Given[]; listeners: SV.StreamListener[]; alive: boolean; success: boolean; count: SV.Count; }
//@class 1009 AsyncParsePluginContext { _p: SV.AsyncParserContext; depth: SV.Depth; }
//@class 1359 DeserializePluginContext { _p: SV.DeserializerContext; depth: SV.Depth; }
//@class 1851 SerializePluginContext { _p: SV.SerializerContext; }
//@class 2482 SyncParsePluginContext { _p: SV.ParserContext; depth: SV.Depth; }
//@class 2491 StreamParsePluginContext { _p: SV.ParserContext; depth: SV.Depth; }
//@class 2948 Serializer { options: SV.Options; alive: boolean; flushed: boolean; done: boolean; pending: SV.Count; cleanups: SV.Cleanup[]; refs: SV.ParserRefs; keys: Set<string>; ids: SV.Count; plugins: SV.Plugins | undefined; }
//    SerovalError (214): `cause` is the library's own member of Error. The other error classes store nothing.

// ---------------------------------------------------------------------------------------------------------------------
// C. EVERY HEAD, SO THAT THE 7 PIECES AGREE: COPY IT. `//@fn <line> <name>(<the parameters>)<: the result>`. No result written = inference gives it (a class's instance, a closure).
//    ctx IS: SV.BaseParserContext 895..1000 · SV.AsyncParserContext 1003..1246 · SV.DeserializerContext 1378..1712 (guardIndexedValue: its base) · SV.SerializerContext 1863..2472
//    (ITS BASE: markSerializerRef isSerializerRefMarked resolveFlags resolvePatches createAssignment isIndexedValueInStack) · SV.ParserContext 2475..2838.
// ---------------------------------------------------------------------------------------------------------------------
// ---- piece 00
//@fn    7 Feature(Feature: SV.EnumTable)
//@fn  119 createSerovalNode(t: SV.NodeType, i: SV.RefId | undefined, s: SV.NodeValue, c: string | SV.TemporalType | undefined, m: string | undefined, p: SV.ObjectRecord | undefined, e: SV.MapRecord | undefined, a: SV.NodeItem[] | undefined, f: SV.SerovalNode | undefined, b: SV.ByteOffset | undefined, o: SV.ObjectFlag | undefined, l: SV.NodeLength | undefined): SV.SerovalNode
//@fn  137 createConstantNode(value: SV.ConstantTag): SV.SerovalNode
//@fn  152 serializeChar(str: string): string | undefined
//@fn  167 serializeString(str: string): string
//@fn  183 deserializeReplacer(str: string): string
//@fn  198 deserializeString(str: SV.GivenString): string
//@fn  210 getErrorMessageProd(type: string): string
//@fn  213 getErrorMessage(type: string, cause: SV.Thrown): string
//@fn  215 constructor(type: string, cause: SV.Thrown)
//@fn  221 constructor(cause: SV.Thrown)
//@fn  226 constructor(cause: SV.Thrown)
//@fn  231 constructor(cause: SV.Thrown)
//@fn  235 getSpecificErrorMessage(code: SV.int32): string
//@fn  239 constructor(value: SV.Given)
//@fn  245 constructor(node: SV.GivenNode)
//@fn  250 constructor(tag: SV.GivenString)
//@fn  255 constructor(tag: string)
//@fn  260 constructor(value: SV.Given)
//@fn  266 constructor(id: string)
//@fn  271 constructor(name: SV.GivenString)
//@fn  276 constructor(node: SV.GivenNode)
//@fn  281 constructor(node: SV.GivenNode)
//@fn  286 constructor(limit: SV.DepthLimit)
//@fn  294 getCrossReferenceHeader(id?: SV.ScopeId): string
//@fn  302 createReference<T>(id: string, value: T): T
//@fn  307 hasReferenceID(value: SV.Given): boolean
//@fn  310 hasReference(id: string): boolean
//@fn  313 getReferenceID(value: SV.Given): string
//@fn  317 getReference(id: string): SV.Given
//@fn  347 getErrorConstructor(error: SV.Given): SV.ErrorTag
//@fn  356 getInitialErrorOptions(error: SV.Given): SV.ErrorOptions
//@fn  362 getErrorOptions(error: SV.Given, features: SV.Features): SV.ErrorOptions
//@fn  383 getObjectFlag(obj: SV.Given): SV.ObjectFlag
//@fn  391 createNumberNode(value: number): SV.SerovalNode
//@fn  400 createStringNode(value: string): SV.SerovalNode
//@fn  403 createBigIntNode(current: bigint): SV.SerovalNode
//@fn  406 createIndexedValueNode(id: SV.RefId): SV.SerovalNode
//@fn  409 createDateNode(id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn  413 createTemporalNode(id: SV.RefId, type: SV.TemporalType, current: SV.Given): SV.SerovalNode
//@fn  416 createRegExpNode(id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn  419 createWKSymbolNode(id: SV.RefId, current: symbol): SV.SerovalNode
//@fn  422 createReferenceNode(id: SV.RefId, ref: SV.Given): SV.SerovalNode
//@fn  425 createPluginNode(id: SV.RefId, tag: SV.GivenString, value: SV.PluginInfo): SV.SerovalNode
//@fn  428 createArrayNode(id: SV.RefId, current: SV.Given, parsedItems: SV.NodeItem[]): SV.SerovalNode
//@fn  431 createBoxedNode(id: SV.RefId, boxed: SV.SerovalNode): SV.SerovalNode
//@fn  435 createTypedArrayNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode
//@fn  439 createBigIntTypedArrayNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode
//@fn  443 createDataViewNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode
//@fn  447 createErrorNode(id: SV.RefId, current: SV.Given, options: SV.ObjectRecord | undefined): SV.SerovalNode
//@fn  450 createAggregateErrorNode(id: SV.RefId, current: SV.Given, options: SV.ObjectRecord | undefined): SV.SerovalNode
//@fn  453 createSetNode(id: SV.RefId, items: SV.SerovalNode[]): SV.SerovalNode
//@fn  456 createIteratorFactoryInstanceNode(factory: SV.SerovalNode, items: SV.SerovalNode): SV.SerovalNode
//@fn  459 createAsyncIteratorFactoryInstanceNode(factory: SV.SerovalNode, items: SV.SerovalNode): SV.SerovalNode
//@fn  462 createStreamConstructorNode(id: SV.RefId, factory: SV.SerovalNode, sequence: SV.SerovalNode[]): SV.SerovalNode
//@fn  465 createStreamNextNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode
//@fn  468 createStreamThrowNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode
//@fn  471 createStreamReturnNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode
//@fn  474 createSequenceNode(id: SV.RefId, sequence: SV.SerovalNode[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex): SV.SerovalNode
// ---- piece 01. 490..692: SIX FUNCTIONS WHOSE TEXT GOES TO THE BROWSER (.toString()): section F. STREAM_CONSTRUCTOR PROMISE_SUCCESS PROMISE_FAILURE are never called here: only their text is used.
//@fn  483 constructor(value: SV.Given, replacement?: SV.Given)
//@fn  490 PROMISE_CONSTRUCTOR(): SV.Deferred
//@fn  502 PROMISE_SUCCESS(resolver: SV.Deferred, data: SV.Given): void
//@fn  507 PROMISE_FAILURE(resolver: SV.Deferred, data: SV.Given): void
//@fn  685 ARRAY_BUFFER_CONSTRUCTOR(b64: string)
//@fn  704 constructor(values: SV.Given[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex)
//@fn  710 isSequence(value: SV.Given): value is InstanceType<typeof Sequence>
//@fn  713 createSequence(values: SV.Given[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex)
//@fn  716 createSequenceFromIterable(source: SV.Given)
//@fn  737 sequenceToIterator(sequence: InstanceType<typeof Sequence>)
//@fn  784 flush(value: SV.Given, mode: SV.StreamEvent): void
//@fn  790 replay(listener: SV.StreamListener): void
//@fn  797 on(listener: SV.StreamListener): SV.Cleanup
//@fn  815 next(value: SV.Given): void
//@fn  821 throw(value: SV.Given): void
//@fn  830 return(value: SV.Given): void
//@fn  840 isStream(value: SV.Given): value is InstanceType<typeof Stream>
//@fn  846 createStreamFromAsyncIterable(iterable: SV.Given, cleanups?: SV.Cleanup[])
//@fn  881 streamToAsyncIterable(stream: InstanceType<typeof Stream>)
//@fn  886 promiseToResult(current: SV.Given): Promise<SV.PromiseResult>
//@fn  895 createBaseParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.BaseParserContext
//@fn  912 markParserRef(ctx: SV.BaseParserContext, id: SV.RefId): void
//@fn  920 createIndexForValue(ctx: SV.BaseParserContext, current: SV.Given): SV.RefId
//@fn  925 getNodeForIndexedValue(ctx: SV.BaseParserContext, current: SV.Given): SV.ParsedRef
//@fn  939 getReferenceNode(ctx: SV.BaseParserContext, current: SV.Given): SV.ParsedRef
//@fn  951 parseWellKnownSymbol(ctx: SV.BaseParserContext, current: symbol): SV.SerovalNode
//@fn  957 parseSpecialReference(ctx: SV.BaseParserContext, ref: SV.SpecialRef): SV.SerovalNode
//    585 ITERATOR_CONSTRUCTOR = (symbol: symbol) => (sequence: InstanceType<typeof Sequence>) => () => {   · 587 const instance: SV.Deserialized (a computed key: no layout; it names itself: TS7022) · 591 next(): SV.IteratorStep {
//    608 ASYNC_ITERATOR_CONSTRUCTOR = (symbol: symbol, createPromise: () => SV.Deferred) => (stream: InstanceType<typeof Stream>) => () => {   · 612 buffer: SV.Given[] · 613 pending: SV.Deferred[] · 648 instance: SV.Deserialized · 652 next(): SV.IteratorStep | SV.Deferred["p"] {
//    515 STREAM_CONSTRUCTOR: 516 buffer: SV.Given[] · 517 listeners: SV.StreamListener[] · value | listener | current: SV.Given | SV.StreamListener · mode: SV.StreamEvent · x z temp: optional SV.int32 (flush(value, mode, x?) up(listener, x?, z?, current?))
// ---- piece 02
//@fn  962 parseIteratorFactory(ctx: SV.BaseParserContext): SV.SerovalNode
//@fn  967 parseAsyncIteratorFactory(ctx: SV.BaseParserContext): SV.SerovalNode
//@fn  972 createObjectNode(id: SV.RefId, current: SV.Given, empty: boolean, record: SV.ObjectRecord): SV.SerovalNode
//@fn  975 createMapNode(ctx: SV.BaseParserContext, id: SV.RefId, k: SV.SerovalNode[], v: SV.SerovalNode[]): SV.SerovalNode
//@fn  981 createPromiseConstructorNode(ctx: SV.BaseParserContext, id: SV.RefId, resolver: SV.RefId): SV.SerovalNode
//@fn  984 getArrayBufferView(ctx: SV.BaseParserContext, current: SV.Given): SV.Given
//@fn  990 encodeArrayBuffer(current: SV.Given): string
//@fn  998 createArrayBufferNode(ctx: SV.BaseParserContext, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 1003 createAsyncParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.AsyncParserContext
//@fn 1010 constructor(_p: SV.AsyncParserContext, depth: SV.Depth)
//@fn 1014 parse(current: SV.Given): Promise<SV.SerovalNode>
//@fn 1018 parseItems$1(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given[]): Promise<SV.NodeItem[]>
//@fn 1024 parseArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given[]): Promise<SV.SerovalNode>
//@fn 1027 parseProperties$1(ctx: SV.AsyncParserContext, depth: SV.Depth, properties: SV.Given): Promise<SV.ObjectRecord>
//@fn 1056 parsePlainObject$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, empty: boolean): Promise<SV.SerovalNode>
//@fn 1059 parseBoxed$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1062 parseTypedArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1066 parseBigIntTypedArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1070 parseDataView$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1074 parseError$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1078 parseAggregateError$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1082 parseMap$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1091 parseSet$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1096 parsePlugin$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode | undefined>
//@fn 1103 parsePromise$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1107 parseStreamHandle(this: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>, resolve: (sequence: SV.SerovalNode[]) => void, reject: (reason: SV.Thrown) => void): void
//@fn 1143 parseStream$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>): Promise<SV.SerovalNode>
//@fn 1146 parseSequence$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Sequence>): Promise<SV.SerovalNode>
//@fn 1151 parseObjectAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1214 parseFunctionAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1221 parseAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1240 parseTopAsync(ctx: SV.AsyncParserContext, current: SV.Given): Promise<SV.SerovalNode>
//@fn 1249 SerovalMode(SerovalMode: SV.EnumTable)
//@fn 1254 createPlugin(plugin: SV.Plugin): SV.Plugin
//@fn 1257 dedupePlugins(deduped: Set<SV.Plugin>, plugins: SV.Plugins): void
//@fn 1266 resolvePlugins(plugins?: SV.Plugins): SV.Plugins | undefined
//@fn 1275 getTypedArrayConstructor(name: SV.GivenString)
//@fn 1293 isValidKey(key: string): boolean
//@fn 1305 isValidSymbol(symbol: symbol): boolean
//@fn 1320 applyObjectFlag(obj: SV.Deserialized, flag: SV.Given): SV.Deserialized
//@fn 1329 createBaseDeserializerContext(mode: SV.Mode, options: SV.DeserializerOptions): SV.BaseDeserializerContext
//@fn 1344 createVanillaDeserializerContext(options: SV.DeserializerOptions): SV.DeserializerContext
//@fn 1352 createCrossDeserializerContext(options: SV.DeserializerOptions): SV.DeserializerContext
//@fn 1360 constructor(_p: SV.DeserializerContext, depth: SV.Depth)
//@fn 1364 deserialize(node: SV.GivenNode): SV.Deserialized
//@fn 1368 guardIndexedValue(ctx: SV.BaseDeserializerContext, id: SV.GivenId): void
//@fn 1375 isThennable(value: SV.Deserialized): boolean
//@fn 1378 assignIndexedValueVanilla<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T
//@fn 1383 assignIndexedValueCross<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T
//@fn 1388 assignIndexedValue$1<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T
//@fn 1391 deserializeKnownValue(node: SV.GivenNode, record: SV.KnownValues, key: SV.Given): SV.Deserialized
//@fn 1395 deserializeReference(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1398 validateNodeList(node: SV.GivenNode, list: SV.Given): void
//@fn 1401 deserializeArray(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1413 assignStringProperty(object: SV.Deserialized, key: string, value: SV.Deserialized): void
//@fn 1422 assignProperty(ctx: SV.DeserializerContext, depth: SV.Depth, object: SV.Deserialized, key: SV.GivenNode, value: SV.GivenNode): void
//@fn 1437 assignNodeType(ctx: SV.DeserializerContext, id: SV.GivenId, type: SV.NodeType): void
//@fn 1440 validateNodeType(ctx: SV.DeserializerContext, node: SV.GivenNode, id: SV.GivenId, type: SV.NodeType): void
// ---- piece 03
//@fn 1443 deserializeProperties(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenRecord, result: SV.Deserialized): SV.Deserialized
//@fn 1450 deserializeObject(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1456 deserializeDate(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1459 deserializeTemporal(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1491 deserializeRegExp(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1499 deserializeSet(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1505 deserializeMap(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1512 deserializeArrayBuffer(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1525 deserializeTypedArray(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1534 deserializeDataView(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1542 deserializeDictionary(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode, result: SV.Deserialized): SV.Deserialized
//@fn 1549 deserializeAggregateError(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1552 deserializeError(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1556 deserializePromise(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1565 deserializeBoxed(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1568 deserializePlugin(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1579 deserializePromiseConstructor(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1584 deserializePromiseFulfill(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1596 deserializeIteratorFactoryInstance(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1602 deserializeAsyncIteratorFactoryInstance(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1608 deserializeStreamConstructor(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1617 deserializeStreamNext(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1626 deserializeStreamThrow(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1635 deserializeStreamReturn(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1644 deserializeIteratorFactory(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1647 deserializeAsyncIteratorFactory(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void
//@fn 1650 isSequenceIndex(value: SV.Given, size: number): boolean
//@fn 1653 deserializeSequence(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1661 deserialize$1(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized
//@fn 1706 deserializeTop(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized
//@fn 1718 createFunction(parameters: string[], body: string): string
//@fn 1722 createEffectfulFunction(parameters: string[], body: string): string
//@fn 1732 getIdentifier(index: number): string
//@fn 1746 isValidIdentifier(name: string): boolean
//@fn 1752 getAssignmentExpression(assignment: SV.Assignment): string | undefined
//@fn 1761 mergeAssignments(assignments: SV.Assignment[]): SV.Assignment[]
//@fn 1799 resolveAssignments(assignments: SV.Assignment[]): string | undefined
//@fn 1818 createBaseSerializerContext(mode: SV.Mode, options: SV.SerializerOptions): SV.BaseSerializerContext
//@fn 1829 createVanillaSerializerState(): SV.VanillaSerializerState
//@fn 1835 createVanillaSerializerContext(options: SV.SerializerOptions): SV.SerializerContext
//@fn 1843 createCrossSerializerContext(options: SV.SerializerOptions): SV.SerializerContext
//@fn 1852 constructor(_p: SV.SerializerContext)
//@fn 1855 serialize(node: SV.GivenNode): string
//@fn 1863 getVanillaRefParam(state: SV.VanillaSerializerState, index: SV.RefId): string
//@fn 1882 getCrossRefParam(id: SV.RefId): string
//@fn 1890 getRefParam(ctx: SV.SerializerContext, id: SV.RefId): string
//@fn 1893 markSerializerRef(ctx: SV.BaseSerializerContext, id: SV.RefId): void
//@fn 1896 isSerializerRefMarked(ctx: SV.BaseSerializerContext, id: SV.RefId): boolean
//@fn 1899 pushObjectFlag(ctx: SV.SerializerContext, flag: SV.ObjectFlag, id: SV.RefId): void
//@fn 1908 resolveFlags(ctx: SV.BaseSerializerContext): string
//@fn 1916 resolvePatches(ctx: SV.BaseSerializerContext): string
// ---- piece 04
//@fn 1930 createAssignment(ctx: SV.BaseSerializerContext, source: string, value: string): void
//@fn 1938 createAddAssignment(ctx: SV.SerializerContext, ref: SV.RefId, value: string): void
//@fn 1946 createSetAssignment(ctx: SV.SerializerContext, ref: SV.RefId, key: string, value: string): void
//@fn 1954 createDeleteAssignment(ctx: SV.SerializerContext, ref: SV.RefId, key: string): void
//@fn 1962 createArrayAssign(ctx: SV.SerializerContext, ref: SV.RefId, index: string | number, value: string): void
//@fn 1965 createObjectAssign(ctx: SV.SerializerContext, ref: SV.RefId, key: string, value: string): void
//@fn 1977 createSequenceAssign(ctx: SV.SerializerContext, ref: SV.RefId, index: SV.int32, value: string): void
//@fn 1984 isIndexedValueInStack(ctx: SV.BaseSerializerContext, node: SV.SerovalNode): boolean
//@fn 1993 assignIndexedValue(ctx: SV.SerializerContext, index: SV.RefId, value: string): string
//@fn 2006 serializeReference(node: SV.SerovalNode): string
//@fn 2009 serializeArrayItem(ctx: SV.SerializerContext, id: SV.RefId, item: SV.NodeItem, index: SV.int32): string
//@fn 2020 serializeArray(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2039 serializeProperty(ctx: SV.SerializerContext, source: SV.SerovalNode, key: SV.RecordKey, val: SV.SerovalNode): string
//@fn 2055 serializeProperties(ctx: SV.SerializerContext, source: SV.SerovalNode, record: SV.ObjectRecord): string
//@fn 2071 serializeObject(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2075 serializeWithObjectAssign(ctx: SV.SerializerContext, source: SV.SerovalNode, value: SV.ObjectRecord, serialized: string): string
//@fn 2080 serializeStringKeyAssignment(ctx: SV.SerializerContext, source: SV.SerovalNode, mainAssignments: SV.Assignment[], key: string, value: SV.SerovalNode): void
//@fn 2096 serializeAssignment(ctx: SV.SerializerContext, source: SV.SerovalNode, mainAssignments: SV.Assignment[], key: SV.RecordKey, value: SV.SerovalNode): void
//@fn 2110 serializeAssignments(ctx: SV.SerializerContext, source: SV.SerovalNode, node: SV.ObjectRecord): string | undefined
//@fn 2122 serializeDictionary(ctx: SV.SerializerContext, node: SV.SerovalNode, init: string): string
//@fn 2134 serializeNullConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2138 serializeDate(node: SV.SerovalNode): string
//@fn 2151 serializeTemporal(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2155 serializeRegExp(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2159 serializeSetItem(ctx: SV.SerializerContext, id: SV.RefId, item: SV.SerovalNode): string
//@fn 2168 serializeSet(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2185 serializeMapEntry(ctx: SV.SerializerContext, id: SV.RefId, key: SV.SerovalNode, val: SV.SerovalNode, sentinel: string): string
//@fn 2223 serializeMap(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2248 serializeArrayBuffer(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2251 serializeTypedArray(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2254 serializeDataView(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2257 serializeAggregateError(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2264 serializeError(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2267 serializePromise(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2284 serializeBoxed(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2287 getConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2291 serializePromiseConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2295 serializePromiseResolve(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2299 serializePromiseReject(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2303 serializePlugin(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2314 serializeIteratorFactory(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2326 serializeIteratorFactoryInstance(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2329 serializeAsyncIteratorFactory(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2347 serializeAsyncIteratorFactoryInstance(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2350 serializeStreamConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2360 serializeStreamNext(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2363 serializeStreamThrow(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2366 serializeStreamReturn(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2369 serializeSequenceItem(ctx: SV.SerializerContext, id: SV.RefId, index: SV.int32, item: SV.SerovalNode): string
//@fn 2378 serializeSequence(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2394 serializeAssignable(ctx: SV.SerializerContext, node: SV.SerovalNode): string
// ---- piece 05
//@fn 2421 serialize$1(ctx: SV.SerializerContext, node: SV.SerovalNode): string
//@fn 2441 serializeTopVanilla(ctx: SV.SerializerContext, tree: SV.SerovalNode): string
//@fn 2457 serializeTopCross(ctx: SV.SerializerContext, tree: SV.SerovalNode): string
//@fn 2475 createSyncParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.ParserContext
//@fn 2483 constructor(_p: SV.ParserContext, depth: SV.Depth)
//@fn 2487 parse(current: SV.Given): SV.SerovalNode
//@fn 2492 constructor(_p: SV.ParserContext, depth: SV.Depth)
//@fn 2496 parse(current: SV.Given): SV.SerovalNode
//@fn 2499 parseWithError(current: SV.Given): SV.SerovalNode | undefined
//@fn 2502 isAlive(): boolean
//@fn 2505 pushPendingState(): void
//@fn 2508 popPendingState(): void
//@fn 2511 onParse(node: SV.GivenNode): void
//@fn 2514 onError(error: SV.Thrown): void
//@fn 2517 addCleanup(callback: SV.Cleanup): void
//@fn 2521 createStreamParserState(options: SV.ParserOptions): SV.StreamParserState
//@fn 2533 createStreamParserContext(options: SV.ParserOptions): SV.ParserContext
//@fn 2540 parseItems(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given[]): SV.NodeItem[]
//@fn 2546 parseArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given[]): SV.SerovalNode
//@fn 2549 parseProperties(ctx: SV.ParserContext, depth: SV.Depth, properties: SV.Given): SV.ObjectRecord
//@fn 2578 parsePlainObject(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, empty: boolean): SV.SerovalNode
//@fn 2581 parseBoxed(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2584 parseTypedArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2588 parseBigIntTypedArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2592 parseDataView(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2596 parseError(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2600 parseAggregateError(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2604 parseMap(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2613 parseSet(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2618 parseStream(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>): SV.SerovalNode
//@fn 2646 handlePromiseSuccess(this: SV.ParserContext, id: SV.RefId, depth: SV.Depth, data: SV.Given): void
//@fn 2653 handlePromiseFailure(this: SV.ParserContext, id: SV.RefId, depth: SV.Depth, data: SV.Given): void
//@fn 2660 parsePromise(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2668 parsePluginSync(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentPlugins: SV.Plugins): SV.SerovalNode | undefined
//@fn 2674 parsePluginStream(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentPlugins: SV.Plugins): SV.SerovalNode | undefined
//@fn 2680 parsePlugin(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode | undefined
//@fn 2684 parseSequence(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Sequence>): SV.SerovalNode
//@fn 2689 parseObjectPhase2(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentClass: SV.GivenClass): SV.SerovalNode
//@fn 2741 parseObject(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode
//@fn 2755 parseFunction(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode
//@fn 2762 parseSOS(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode
//@fn 2781 parseTop(ctx: SV.ParserContext, current: SV.Given): SV.SerovalNode
//@fn 2788 onParse(ctx: SV.ParserContext, node: SV.SerovalNode): void
//@fn 2792 onError(ctx: SV.ParserContext, error: SV.Thrown): void
//@fn 2796 onDone(ctx: SV.ParserContext): void
//@fn 2800 onParseInternal(ctx: SV.ParserContext, node: SV.SerovalNode, initial: boolean): void
//@fn 2807 pushPendingState(ctx: SV.ParserContext): void
//@fn 2810 popPendingState(ctx: SV.ParserContext): void
//@fn 2813 parseWithError(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode | undefined
//@fn 2821 startStreamParse(ctx: SV.ParserContext, current: SV.Given): void
//@fn 2830 flushStreamParse(ctx: SV.ParserContext, state: SV.StreamParserState): void
//@fn 2833 destroyStreamParse(ctx: SV.ParserContext): void
//@fn 2841 crossSerialize(source: SV.Given, options: SV.Options = {}): string
//@fn 2857 crossSerializeAsync(source: SV.Given, options: SV.Options = {}): Promise<string>
//@fn 2873 toCrossJSON(source: SV.Given, options: SV.Options = {}): SV.SerovalNode
//@fn 2882 toCrossJSONAsync(source: SV.Given, options: SV.Options = {}): Promise<SV.SerovalNode>
//@fn 2891 crossSerializeStream(source: SV.Given, options: SV.Options): SV.Cleanup
//@fn 2898 onParse(node: SV.SerovalNode, initial: boolean)
//    2893 const ctx: SV.ParserContext (it is named inside its own initializer: TS7022)
// ---- piece 06
//@fn 2920 toCrossJSONStream(source: SV.Given, options: SV.Options): SV.Cleanup
//@fn 2935 fromCrossJSON(source: SV.GivenNode, options: SV.Options): SV.Deserialized
//@fn 2949 constructor(options: SV.Options)
//@fn 2961 write(key: string, value: SV.Given): void
//@fn 2987 getNextID(): string
//@fn 2991 push(value: SV.Given): string
//@fn 2996 flush(): void
//@fn 3005 close(): void
//@fn 3018 serialize(source: SV.Given, options: SV.Options = {}): string
//@fn 3032 serializeAsync(source: SV.Given, options: SV.Options = {}): Promise<string>
//@fn 3046 deserialize(source: SV.GivenString): SV.Deserialized
//@fn 3049 toJSON(source: SV.Given, options: SV.Options = {}): SV.SerovalJSON
//@fn 3062 toJSONAsync(source: SV.Given, options: SV.Options = {}): Promise<SV.SerovalJSON>
//@fn 3075 compileJSON(source: SV.GivenJSON, options: SV.Options = {}): string
//@fn 3082 fromJSON(source: SV.GivenJSON, options: SV.Options = {}): SV.Deserialized

// ---------------------------------------------------------------------------------------------------------------------
// D. BIRTHS LEFT WITHOUT AN INTERFACE, ON PURPOSE: handed straight to a built-in or to given code, never stored to again; or no birth at all.
// ---------------------------------------------------------------------------------------------------------------------
// 321 327 333 339 1415 { value, configurable, writable | enumerable .. } -> Object.defineProperty · 1334 { types } -> Object.assign · 1758: NO BIRTH: text inside a string
// 1100 1574 2309 2671 2677 { id } -> the plugin's third argument (given code reads it by name; a type here would buy nothing)
// 1369 { t, i } -> SerovalMalformedNodeError, whose constructor drops it
// 620 1109 2622 { next, throw, return } -> Stream.on: SV.StreamListener (NOT IN births.txt: their members are functions)
// 2965 { plugins, scopeId, refs, disabledFeatures, compactArrayBufferViews, onError, onSerialize, onDone } -> crossSerializeStream's options, which is public: SV.Options (NOT IN births.txt)
// 521 { flush, up, on } 553 { __SEROVAL_STREAM__, on, next, throw, return }: STREAM_CONSTRUCTOR is never called here · 614 { finalize }: a local, inference
// 587 648 { [symbol], next }: a computed key: SV.Deserialized
// DICTIONARIES AND TABLES, NOT LAYOUTS (section 3): 16 34 49 64 79 89 99 108 205 358 359 360 370 374 747 755 1253 1812 2141
// {} THAT STAND FOR THEMSELVES, keys of refs: 742 743 748..753 2661: inference · {} AND Object.create(null) THAT ARE WHAT IS BUILT: 1451 1544: SV.Deserialized · `options = {}`: SV.Options

// ---------------------------------------------------------------------------------------------------------------------
// E. THE BORDER (rule 4d): WHO WALKS WHAT
// ---------------------------------------------------------------------------------------------------------------------
// BORN: SV.SerovalNode · SV.ObjectRecord · SV.MapRecord · SV.NodeItem · SV.RecordKey
//   all that MAKES nodes: 119..476 · 895..1000 · the async parser 1003..1246 · the sync | stream parser 2475..2838 · the public functions' `tree` (2849 2865 3025 3039)
//   AND THE WHOLE SERIALIZER, 1752..2472: every `node source tree item key val value record fulfilled sentinel promise symbol`.
// GIVEN: SV.GivenNode · SV.GivenRecord · SV.GivenId · SV.GivenJSON
//   THE WHOLE DESERIALIZER, 1320..1712: every `node key value list items keys vals item id`: deserialize$1 and every deserialize* under it, deserializeTop, deserializeKnownValue validateNodeList assignProperty
//   assignNodeType validateNodeType guardIndexedValue assignIndexedValue* applyObjectFlag's flag isSequenceIndex's value · DeserializePluginContext.deserialize (1364) · fromCrossJSON's source (2935) · fromJSON's source (3082).
//   ITS CONTEXTS ARE BORN AND TYPED: only the nodes and what is read off them are any.
// SERVE BOTH SIDES, SO GIVEN: deserializeString (198: the deserializer's node.s | c | m, and the serializer's node.c at 2156) · the error classes' constructors that take a node | tag | name (245 250 271 276 281): none reads it.
// THREE DOORS LET A NODE FROM OUTSIDE INTO THE SERIALIZER. AT EACH THE PARAMETER IS GIVEN AND THE CALL BEHIND IT HANDS THE any TO A PARAMETER TYPED SV.SerovalNode: THAT CALL IS THE DOOR: no cast is needed, none is to be written:
//   1  3080 compileJSON: source.t -> serializeTopVanilla (and 3078 source.f -> features, 3079 source.m -> markedRefs)
//   2  1856 SerializePluginContext.serialize(node) -> serialize$1: A PLUGIN'S HAND
//   3  2512 StreamParsePluginContext.onParse(node) -> onParse -> state.buffer (2789) | state.onParse (2802) -> 2907 serializeTopCross
// WHY THE SERIALIZER IS NOT GIVEN FOR ALL THAT ("where one function serves both it is given" would make all of 1752..2472 any, half of what this typing is for):
//   door 2 is the only one a TanStack render goes through, and what goes through it is a node ctx.parse() made in this very call: READ: the six plugin files of @tanstack/router-core 1.171.35 and all of
//   seroval-plugins/web 1.6.9 hand ctx.serialize nothing but `node.<member>` = the result of ctx.parse; none calls ctx.onParse; none writes a node of its own. No @tanstack package imports compileJSON
//   (they import crossSerializeStream serialize toCrossJSONAsync toCrossJSONStream toJSONAsync fromJSON fromCrossJSON createPlugin createStream getCrossReferenceHeader).
//   The serializer only READS nodes and never compares them: a copy at a door would be dear, not wrong.
// NOTE: compileJSON(JSON.parse(..)) IS WHAT BREAKS: such a node has 2 to 6 of the 12 members, and its a | f | p.k | p.v | e.k | e.v hold more of the kind: a door that refuses says "expected SerovalNode, got plain object"
//   (as ResumableState's did), a door that copies must fill in undefined AND COPY DEEP. compileJSON(toJSON(x)) without JSON between passes. IF IT MUST HOLD: in 1752..2472 SV.SerovalNode | NodeItem | RecordKey > SV.GivenNode,
//   SV.ObjectRecord | MapRecord > SV.GivenRecord: the casts and ! stay valid on any.

// ---------------------------------------------------------------------------------------------------------------------
// F. IDIOMS, probed on the checker
// ---------------------------------------------------------------------------------------------------------------------
// "" + node.s · "\"" + node.s + "\"" · node.s + "n" PASS WITH s unknown (string + unknown is a string): BUT THEN THE + IS THE GENERIC ONE, in serialize$1's first four cases: for every number, string, constant, bigint.
//   WRITE THE CAST: "\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\"" · CONSTANT_STRING[node.s/*$*/ as SV.ConstantTag/*$*/] (TS2538 without) · TEMPORAL_CONSTRUCTOR[node.c/*$*/ as SV.TemporalType/*$*/]
// node.i IS RefId | undefined: getRefParam(ctx, node.i!) · const id = node.i! · serialize$1(ctx, node.f!) · serializeProperties(ctx, node, node.p!): TS2345: `bang` DOES NOT PUT THOSE (some 85, nearly all in piece 04)
//   nor TS2532: this._p.state!.alive (2503 2518) this.state!.alive (2647 2654). It puts ! only on "'x' is possibly undefined": node.a!.length node.f!.t node.e!.k ctx.state!.alive
// `if (item)` narrows SV.NodeItem to the node (2010) · typeof key === "string" narrows SV.RecordKey (2040 2097) · a pair's halves: node.a![0]/*$*/ as SV.SerovalNode/*$*/
// const nodes: SV.NodeItem[] = [] (1019 2541) · keyNodes: SV.RecordKey[] (1029 2551) but SV.SerovalNode[] in parseMap (1083 2605) · valueNodes items nodes sequence: SV.SerovalNode[] · SV.SerovalNode[] goes into a: SV.NodeItem[] | undefined as it is
// isStream(x) | isSequence(x) narrow an any to the class · Array.isArray narrows an any to any[]
// catch (error: SV.Thrown) · new Set<SV.Plugin>() (1268) · new Map<..>() comes by itself where the member or variable around it is typed · await new Promise<SV.SerovalNode[]>(parseStreamHandle.bind(ctx, depth, id, current)) (1144)
// getAssignmentExpression's switch has no default: string | undefined is the honest result: s: getAssignmentExpression(current)! (1774 1780 1786); + takes it as it is (1803)
// REFERENCE.get(value)! (314) · the literal { p: 0, s: 0, f: 0 } fits SV.Deferred; deferred.s(x) is TS2349: the cast of section 7
// /*$*/(/*$*/ctx.base.refs/*$*/ as any)/*$*/.types (1438 1441) · "types" in refs and Object.assign(refs, ..) pass as they are (refs is any there: options.refs || new Map())
// THE SIX OF 490..692 AND RETURN (1715): .toString() GIVES THEIR TEXT TO THE BROWSER: what is written inside them must strip clean (verify sees to it). NOTE: an engine that keeps a function's ORIGINAL text would send TypeScript to the browser.
