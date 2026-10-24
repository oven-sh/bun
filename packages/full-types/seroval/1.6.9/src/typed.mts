/// <reference path="./sv-shapes-01.d.ts" />
/// <reference path="./sv-shapes-90.d.ts" />
/// <reference path="./sv-shapes.d.ts" />
//#region src/core/compat.ts
/**
* References
* - https://compat-table.github.io/compat-table/es6/
* - MDN
*/
let Feature = /* @__PURE__ */ function(Feature: SV.EnumTable) {
	Feature[Feature["AggregateError"] = 1] = "AggregateError";
	Feature[Feature["ArrowFunction"] = 2] = "ArrowFunction";
	Feature[Feature["ErrorPrototypeStack"] = 4] = "ErrorPrototypeStack";
	Feature[Feature["ObjectAssign"] = 8] = "ObjectAssign";
	Feature[Feature["BigIntTypedArray"] = 16] = "BigIntTypedArray";
	Feature[Feature["RegExp"] = 32] = "RegExp";
	Feature[Feature["Temporal"] = 64] = "Temporal";
	return Feature;
}({});
//#endregion
//#region src/core/symbols.ts
const SYM_ASYNC_ITERATOR = Symbol.asyncIterator;
const SYM_HAS_INSTANCE = Symbol.hasInstance;
const SYM_IS_CONCAT_SPREADABLE = Symbol.isConcatSpreadable;
const SYM_ITERATOR = Symbol.iterator;
const SYM_MATCH = Symbol.match;
const SYM_MATCH_ALL = Symbol.matchAll;
const SYM_REPLACE = Symbol.replace;
const SYM_SEARCH = Symbol.search;
const SYM_SPECIES = Symbol.species;
const SYM_SPLIT = Symbol.split;
const SYM_TO_PRIMITIVE = Symbol.toPrimitive;
const SYM_TO_STRING_TAG = Symbol.toStringTag;
const SYM_UNSCOPABLES = Symbol.unscopables;
//#endregion
//#region src/core/constants.ts
const SYMBOL_STRING: SV.StringTable = {
	[0]: "Symbol.asyncIterator",
	[1]: "Symbol.hasInstance",
	[2]: "Symbol.isConcatSpreadable",
	[3]: "Symbol.iterator",
	[4]: "Symbol.match",
	[5]: "Symbol.matchAll",
	[6]: "Symbol.replace",
	[7]: "Symbol.search",
	[8]: "Symbol.species",
	[9]: "Symbol.split",
	[10]: "Symbol.toPrimitive",
	[11]: "Symbol.toStringTag",
	[12]: "Symbol.unscopables"
};
const INV_SYMBOL_REF: SV.SymbolTags = {
	[SYM_ASYNC_ITERATOR]: 0,
	[SYM_HAS_INSTANCE]: 1,
	[SYM_IS_CONCAT_SPREADABLE]: 2,
	[SYM_ITERATOR]: 3,
	[SYM_MATCH]: 4,
	[SYM_MATCH_ALL]: 5,
	[SYM_REPLACE]: 6,
	[SYM_SEARCH]: 7,
	[SYM_SPECIES]: 8,
	[SYM_SPLIT]: 9,
	[SYM_TO_PRIMITIVE]: 10,
	[SYM_TO_STRING_TAG]: 11,
	[SYM_UNSCOPABLES]: 12
};
const SYMBOL_REF: SV.SymbolTable = {
	[0]: SYM_ASYNC_ITERATOR,
	[1]: SYM_HAS_INSTANCE,
	[2]: SYM_IS_CONCAT_SPREADABLE,
	[3]: SYM_ITERATOR,
	[4]: SYM_MATCH,
	[5]: SYM_MATCH_ALL,
	[6]: SYM_REPLACE,
	[7]: SYM_SEARCH,
	[8]: SYM_SPECIES,
	[9]: SYM_SPLIT,
	[10]: SYM_TO_PRIMITIVE,
	[11]: SYM_TO_STRING_TAG,
	[12]: SYM_UNSCOPABLES
};
const CONSTANT_STRING: SV.StringTable = {
	[2]: "!0",
	[3]: "!1",
	[1]: "void 0",
	[0]: "null",
	[4]: "-0",
	[5]: "1/0",
	[6]: "-1/0",
	[7]: "0/0"
};
const CONSTANT_VAL: SV.KnownValues = {
	[2]: true,
	[3]: false,
	[1]: void 0,
	[0]: null,
	[4]: -0,
	[5]: Number.POSITIVE_INFINITY,
	[6]: Number.NEGATIVE_INFINITY,
	[7]: NaN
};
const ERROR_CONSTRUCTOR_STRING: SV.StringTable = {
	[0]: "Error",
	[1]: "EvalError",
	[2]: "RangeError",
	[3]: "ReferenceError",
	[4]: "SyntaxError",
	[5]: "TypeError",
	[6]: "URIError"
};
const ERROR_CONSTRUCTOR: SV.KnownValues = {
	[0]: Error,
	[1]: EvalError,
	[2]: RangeError,
	[3]: ReferenceError,
	[4]: SyntaxError,
	[5]: TypeError,
	[6]: URIError
};
//#endregion
//#region src/core/node.ts
function createSerovalNode(t: SV.NodeType, i: SV.RefId | undefined, s: SV.NodeValue, c: string | SV.TemporalType | undefined, m: string | undefined, p: SV.ObjectRecord | undefined, e: SV.MapRecord | undefined, a: SV.NodeItem[] | undefined, f: SV.SerovalNode | undefined, b: SV.ByteOffset | undefined, o: SV.ObjectFlag | undefined, l: SV.NodeLength | undefined): SV.SerovalNode {
	return {
		t,
		i,
		s,
		c,
		m,
		p,
		e,
		a,
		f,
		b,
		o,
		l
	};
}
//#endregion
//#region src/core/literals.ts
function createConstantNode(value: SV.ConstantTag): SV.SerovalNode {
	return createSerovalNode(2, void 0, value, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
const TRUE_NODE = /* @__PURE__ */ createConstantNode(2);
const FALSE_NODE = /* @__PURE__ */ createConstantNode(3);
const UNDEFINED_NODE = /* @__PURE__ */ createConstantNode(1);
const NULL_NODE = /* @__PURE__ */ createConstantNode(0);
const NEG_ZERO_NODE = /* @__PURE__ */ createConstantNode(4);
const INFINITY_NODE = /* @__PURE__ */ createConstantNode(5);
const NEG_INFINITY_NODE = /* @__PURE__ */ createConstantNode(6);
const NAN_NODE = /* @__PURE__ */ createConstantNode(7);
//#endregion
//#region src/core/string.ts
const MIN_JSON_STRINGIFY_LENGTH = 64;
const JSON_ESCAPE_DIFFERENCES = /[\x00-\x07\x0b\x0e-\x1f<\u2028\u2029\ud800-\udfff]/;
function serializeChar(str: string): string | undefined {
	switch (str) {
		case "\"": return "\\\"";
		case "\\": return "\\\\";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "\b": return "\\b";
		case "	": return "\\t";
		case "\f": return "\\f";
		case "<": return "\\x3C";
		case "\u2028": return "\\u2028";
		case "\u2029": return "\\u2029";
		default: return;
	}
}
function serializeString(str: string): string {
	if (str.length >= MIN_JSON_STRINGIFY_LENGTH && !JSON_ESCAPE_DIFFERENCES.test(str)) return JSON.stringify(str).slice(1, -1);
	let result = "";
	let lastPos = 0;
	let replacement: string | undefined;
	for (let i = 0, len = str.length; i < len; i++) {
		replacement = serializeChar(str[i]);
		if (replacement) {
			result += str.slice(lastPos, i) + replacement;
			lastPos = i + 1;
		}
	}
	if (lastPos === 0) result = str;
	else result += str.slice(lastPos);
	return result;
}
function deserializeReplacer(str: string): string {
	switch (str) {
		case "\\\\": return "\\";
		case "\\\"": return "\"";
		case "\\n": return "\n";
		case "\\r": return "\r";
		case "\\b": return "\b";
		case "\\t": return "	";
		case "\\f": return "\f";
		case "\\x3C": return "<";
		case "\\u2028": return "\u2028";
		case "\\u2029": return "\u2029";
		default: return str;
	}
}
function deserializeString(str: SV.GivenString): string {
	if (typeof str === "string" && !str.includes("\\")) return str;
	return str.replace(/(\\\\|\\"|\\n|\\r|\\b|\\t|\\f|\\u2028|\\u2029|\\x3C)/g, deserializeReplacer);
}
//#endregion
//#region src/core/errors.ts
const { toString: objectToString } = Object.prototype;
const STEP_ERROR_CODES: SV.StepCodes = {
	parsing: 1,
	serialization: 2,
	deserialization: 3
};
function getErrorMessageProd(type: string): string {
	return `Seroval Error (step: ${STEP_ERROR_CODES[type]})`;
}
const getErrorMessage = (type: string, cause: SV.Thrown): string => getErrorMessageProd(type);
var SerovalError = class extends Error {
	constructor(type: string, cause: SV.Thrown) {
		super(getErrorMessage(type, cause));
		/*$*/(/*$*/this/*$*/ as any)/*$*/.cause = cause;
	}
};
var SerovalParserError = class extends SerovalError {
	constructor(cause: SV.Thrown) {
		super("parsing", cause);
	}
};
var SerovalSerializationError = class extends SerovalError {
	constructor(cause: SV.Thrown) {
		super("serialization", cause);
	}
};
var SerovalDeserializationError = class extends SerovalError {
	constructor(cause: SV.Thrown) {
		super("deserialization", cause);
	}
};
function getSpecificErrorMessage(code: SV.int32): string {
	return `Seroval Error (specific: ${code})`;
}
var SerovalUnsupportedTypeError = class extends Error { /*$*/declare value: SV.Given;/*$*/
	constructor(value: SV.Given) {
		super(getSpecificErrorMessage(1));
		this.value = value;
	}
};
var SerovalUnsupportedNodeError = class extends Error {
	constructor(node: SV.GivenNode) {
		super(getSpecificErrorMessage(2));
	}
};
var SerovalMissingPluginError = class extends Error {
	constructor(tag: SV.GivenString) {
		super(getSpecificErrorMessage(3));
	}
};
var SerovalMissingInstanceError = class extends Error {
	constructor(tag: string) {
		super(getSpecificErrorMessage(4));
	}
};
var SerovalMissingReferenceError = class extends Error { /*$*/declare value: SV.Given;/*$*/
	constructor(value: SV.Given) {
		super(getSpecificErrorMessage(5));
		this.value = value;
	}
};
var SerovalMissingReferenceForIdError = class extends Error {
	constructor(id: string) {
		super(getSpecificErrorMessage(6));
	}
};
var SerovalUnknownTypedArrayError = class extends Error {
	constructor(name: SV.GivenString) {
		super(getSpecificErrorMessage(7));
	}
};
var SerovalMalformedNodeError = class extends Error {
	constructor(node: SV.GivenNode) {
		super(getSpecificErrorMessage(8));
	}
};
var SerovalConflictedNodeIdError = class extends Error {
	constructor(node: SV.GivenNode) {
		super(getSpecificErrorMessage(9));
	}
};
var SerovalDepthLimitError = class extends Error {
	constructor(limit: SV.DepthLimit) {
		super(getSpecificErrorMessage(9));
	}
};
//#endregion
//#region src/core/keys.ts
const REFERENCES_KEY = "__SEROVAL_REFS__";
const GLOBAL_CONTEXT_R = `self.\$R`;
function getCrossReferenceHeader(id?: SV.ScopeId): string {
	if (id == null) return `${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||[]`;
	return `(${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||{})["${serializeString(id)}"]=[]`;
}
//#endregion
//#region src/core/reference.ts
const REFERENCE: Map<SV.Given, string> = /* @__PURE__ */ new Map();
const INV_REFERENCE: Map<string, SV.Given> = /* @__PURE__ */ new Map();
function createReference<T>(id: string, value: T): T {
	REFERENCE.set(value, id);
	INV_REFERENCE.set(id, value);
	return value;
}
function hasReferenceID(value: SV.Given): boolean {
	return REFERENCE.has(value);
}
function hasReference(id: string): boolean {
	return INV_REFERENCE.has(id);
}
function getReferenceID(value: SV.Given): string {
	if (hasReferenceID(value)) return REFERENCE.get(value)!;
	throw new SerovalMissingReferenceError(value);
}
function getReference(id: string): SV.Given {
	if (hasReference(id)) return INV_REFERENCE.get(id);
	throw new SerovalMissingReferenceForIdError(id);
}
if (typeof globalThis !== "undefined") Object.defineProperty(globalThis, REFERENCES_KEY, {
	value: INV_REFERENCE,
	configurable: true,
	writable: false,
	enumerable: false
});
else if (typeof window !== "undefined") Object.defineProperty(window, REFERENCES_KEY, {
	value: INV_REFERENCE,
	configurable: true,
	writable: false,
	enumerable: false
});
else if (typeof self !== "undefined") Object.defineProperty(self, REFERENCES_KEY, {
	value: INV_REFERENCE,
	configurable: true,
	writable: false,
	enumerable: false
});
else if (typeof global !== "undefined") Object.defineProperty(global, REFERENCES_KEY, {
	value: INV_REFERENCE,
	configurable: true,
	writable: false,
	enumerable: false
});
//#endregion
//#region src/core/utils/error.ts
function getErrorConstructor(error: SV.Given): SV.ErrorTag {
	if (error instanceof EvalError) return 1;
	if (error instanceof RangeError) return 2;
	if (error instanceof ReferenceError) return 3;
	if (error instanceof SyntaxError) return 4;
	if (error instanceof TypeError) return 5;
	if (error instanceof URIError) return 6;
	return 0;
}
function getInitialErrorOptions(error: SV.Given): SV.ErrorOptions {
	const construct = ERROR_CONSTRUCTOR_STRING[getErrorConstructor(error)];
	if (error.name !== construct) return { name: error.name };
	if (error.constructor.name !== construct) return { name: error.constructor.name };
	return {};
}
function getErrorOptions(error: SV.Given, features: SV.Features): SV.ErrorOptions {
	let options: SV.ErrorOptions = getInitialErrorOptions(error);
	const names = Object.getOwnPropertyNames(error);
	for (let i = 0, len = names.length, name: string; i < len; i++) {
		name = names[i];
		if (name !== "name" && name !== "message") {
			if (name === "stack") {
				if (features & 4) {
					options = options || {};
					options[name] = error[name];
				}
			} else {
				options = options || {};
				options[name] = error[name];
			}
		}
	}
	return options;
}
//#endregion
//#region src/core/utils/get-object-flag.ts
function getObjectFlag(obj: SV.Given): SV.ObjectFlag {
	if (Object.isFrozen(obj)) return 3;
	if (Object.isSealed(obj)) return 2;
	if (Object.isExtensible(obj)) return 0;
	return 1;
}
//#endregion
//#region src/core/base-primitives.ts
function createNumberNode(value: number): SV.SerovalNode {
	switch (value) {
		case Number.POSITIVE_INFINITY: return INFINITY_NODE;
		case Number.NEGATIVE_INFINITY: return NEG_INFINITY_NODE;
	}
	if (value !== value) return NAN_NODE;
	if (Object.is(value, -0)) return NEG_ZERO_NODE;
	return createSerovalNode(0, void 0, value, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createStringNode(value: string): SV.SerovalNode {
	return createSerovalNode(1, void 0, serializeString(value), void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createBigIntNode(current: bigint): SV.SerovalNode {
	return createSerovalNode(3, void 0, "" + current, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createIndexedValueNode(id: SV.RefId): SV.SerovalNode {
	return createSerovalNode(4, id, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createDateNode(id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const timestamp = current.valueOf();
	return createSerovalNode(5, id, timestamp !== timestamp ? "" : current.toISOString(), void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createTemporalNode(id: SV.RefId, type: SV.TemporalType, current: SV.Given): SV.SerovalNode {
	return createSerovalNode(36, id, current.toString(), type, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createRegExpNode(id: SV.RefId, current: SV.Given): SV.SerovalNode {
	return createSerovalNode(6, id, void 0, serializeString(current.source), current.flags, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createWKSymbolNode(id: SV.RefId, current: symbol): SV.SerovalNode {
	return createSerovalNode(17, id, INV_SYMBOL_REF[current], void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createReferenceNode(id: SV.RefId, ref: SV.Given): SV.SerovalNode {
	return createSerovalNode(18, id, serializeString(getReferenceID(ref)), void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createPluginNode(id: SV.RefId, tag: SV.GivenString, value: SV.PluginInfo): SV.SerovalNode {
	return createSerovalNode(25, id, value, serializeString(tag), void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createArrayNode(id: SV.RefId, current: SV.Given, parsedItems: SV.NodeItem[]): SV.SerovalNode {
	return createSerovalNode(9, id, void 0, void 0, void 0, void 0, void 0, parsedItems, void 0, void 0, getObjectFlag(current), void 0);
}
function createBoxedNode(id: SV.RefId, boxed: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(21, id, void 0, void 0, void 0, void 0, void 0, void 0, boxed, void 0, void 0, void 0);
}
const MAX_TYPED_ARRAY_LENGTH = 1e6;
function createTypedArrayNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode {
	if (current.length > MAX_TYPED_ARRAY_LENGTH) throw new SerovalUnsupportedTypeError(current);
	return createSerovalNode(15, id, void 0, current.constructor.name, void 0, void 0, void 0, void 0, buffer, current.byteOffset, void 0, current.length);
}
function createBigIntTypedArrayNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode {
	if (current.length > MAX_TYPED_ARRAY_LENGTH) throw new SerovalUnsupportedTypeError(current);
	return createSerovalNode(16, id, void 0, current.constructor.name, void 0, void 0, void 0, void 0, buffer, current.byteOffset, void 0, current.length);
}
function createDataViewNode(id: SV.RefId, current: SV.Given, buffer: SV.SerovalNode): SV.SerovalNode {
	if (current.byteLength > MAX_TYPED_ARRAY_LENGTH) throw new SerovalUnsupportedTypeError(current);
	return createSerovalNode(20, id, void 0, void 0, void 0, void 0, void 0, void 0, buffer, current.byteOffset, void 0, current.byteLength);
}
function createErrorNode(id: SV.RefId, current: SV.Given, options: SV.ObjectRecord | undefined): SV.SerovalNode {
	return createSerovalNode(13, id, getErrorConstructor(current), void 0, serializeString(current.message), options, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createAggregateErrorNode(id: SV.RefId, current: SV.Given, options: SV.ObjectRecord | undefined): SV.SerovalNode {
	return createSerovalNode(14, id, getErrorConstructor(current), void 0, serializeString(current.message), options, void 0, void 0, void 0, void 0, void 0, void 0);
}
function createSetNode(id: SV.RefId, items: SV.SerovalNode[]): SV.SerovalNode {
	return createSerovalNode(7, id, void 0, void 0, void 0, void 0, void 0, items, void 0, void 0, void 0, void 0);
}
function createIteratorFactoryInstanceNode(factory: SV.SerovalNode, items: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(28, void 0, void 0, void 0, void 0, void 0, void 0, [factory, items], void 0, void 0, void 0, void 0);
}
function createAsyncIteratorFactoryInstanceNode(factory: SV.SerovalNode, items: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(30, void 0, void 0, void 0, void 0, void 0, void 0, [factory, items], void 0, void 0, void 0, void 0);
}
function createStreamConstructorNode(id: SV.RefId, factory: SV.SerovalNode, sequence: SV.SerovalNode[]): SV.SerovalNode {
	return createSerovalNode(31, id, void 0, void 0, void 0, void 0, void 0, sequence, factory, void 0, void 0, void 0);
}
function createStreamNextNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(32, id, void 0, void 0, void 0, void 0, void 0, void 0, parsed, void 0, void 0, void 0);
}
function createStreamThrowNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(33, id, void 0, void 0, void 0, void 0, void 0, void 0, parsed, void 0, void 0, void 0);
}
function createStreamReturnNode(id: SV.RefId, parsed: SV.SerovalNode): SV.SerovalNode {
	return createSerovalNode(34, id, void 0, void 0, void 0, void 0, void 0, void 0, parsed, void 0, void 0, void 0);
}
function createSequenceNode(id: SV.RefId, sequence: SV.SerovalNode[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex): SV.SerovalNode {
	return createSerovalNode(35, id, throwAt, void 0, void 0, void 0, void 0, sequence, void 0, void 0, void 0, doneAt);
}
//#endregion
//#region src/core/opaque-reference.ts
/**
* An opaque reference allows hiding values from the serializer.
*/
var OpaqueReference = class { /*$*/declare value: SV.Given; declare replacement: SV.Given;/*$*/
	constructor(value: SV.Given, replacement?: SV.Given) {
		this.value = value;
		this.replacement = replacement;
	}
};
//#endregion
//#region src/core/constructors.ts
const PROMISE_CONSTRUCTOR = (): SV.Deferred => {
	const resolver: SV.Deferred = {
		p: 0,
		s: 0,
		f: 0
	};
	resolver.p = new Promise((resolve: SV.Settle, reject: SV.Settle) => {
		resolver.s = resolve;
		resolver.f = reject;
	});
	return resolver;
};
const PROMISE_SUCCESS = (resolver: SV.Deferred, data: SV.Given): void => {
	/*$*/(/*$*/resolver.s/*$*/ as SV.Settle)/*$*/(data);
	/*$*/(/*$*/resolver.p/*$*/ as any)/*$*/.s = 1;
	/*$*/(/*$*/resolver.p/*$*/ as any)/*$*/.v = data;
};
const PROMISE_FAILURE = (resolver: SV.Deferred, data: SV.Given): void => {
	/*$*/(/*$*/resolver.f/*$*/ as SV.Settle)/*$*/(data);
	/*$*/(/*$*/resolver.p/*$*/ as any)/*$*/.s = 2;
	/*$*/(/*$*/resolver.p/*$*/ as any)/*$*/.v = data;
};
const SERIALIZED_PROMISE_CONSTRUCTOR = /* @__PURE__ */ PROMISE_CONSTRUCTOR.toString();
const SERIALIZED_PROMISE_SUCCESS = /* @__PURE__ */ PROMISE_SUCCESS.toString();
const SERIALIZED_PROMISE_FAILURE = /* @__PURE__ */ PROMISE_FAILURE.toString();
const STREAM_CONSTRUCTOR = () => {
	const buffer: SV.Given[] = [];
	const listeners: SV.StreamListener[] = [];
	let alive = true;
	let success = false;
	let count: SV.Count = 0;
	const internal = {
		flush(value: SV.Given, mode: SV.StreamEvent, x?: number): void {
			for (x = 0; x < count; x++) {
				const listener = listeners[x];
				if (listener) listener[mode](value);
			}
		},
		up(listener: SV.StreamListener, x?: number, z?: number, current?: SV.Given): void {
			for (x = 0, z = buffer.length; x < z; x++) {
				current = buffer[x];
				if (!alive && x === z - 1) listener[success ? "return" : "throw"](current);
				else listener.next(current);
			}
		},
		on(listener: SV.StreamListener, temp: number = 0): SV.Cleanup {
			let subscribed = alive;
			if (alive) {
				for (temp = 0; temp < count; temp++) if (!listeners[temp]) break;
				if (temp === count) count++;
				listeners[temp] = listener;
			}
			internal.up(listener);
			return () => {
				if (alive && subscribed) {
					subscribed = false;
					listeners[temp] = void 0;
					while (count > 0 && !listeners[count - 1]) count--;
					listeners.length = count;
				}
			};
		}
	};
	return {
		__SEROVAL_STREAM__: true,
		on(listener: SV.StreamListener): SV.Cleanup {
			return internal.on(listener);
		},
		next(value: SV.Given): void {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "next");
			}
		},
		throw(value: SV.Given): void {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "throw");
				alive = false;
				success = false;
				listeners.length = 0;
			}
		},
		return(value: SV.Given): void {
			if (alive) {
				buffer.push(value);
				internal.flush(value, "return");
				alive = false;
				success = true;
				listeners.length = 0;
			}
		}
	};
};
const SERIALIZED_STREAM_CONSTRUCTOR = /* @__PURE__ */ STREAM_CONSTRUCTOR.toString();
const ITERATOR_CONSTRUCTOR = (symbol: symbol) => (sequence: InstanceType<typeof Sequence>) => () => {
	let index: number = 0;
	const instance: SV.Deserialized = {
		[symbol]() {
			return instance;
		},
		next(): SV.IteratorStep {
			if (index > sequence.d) return {
				done: true,
				value: void 0
			};
			const currentIndex = index++;
			const data = sequence.v[currentIndex];
			if (currentIndex === sequence.t) throw data;
			return {
				done: currentIndex === sequence.d,
				value: data
			};
		}
	};
	return instance;
};
const SERIALIZED_ITERATOR_CONSTRUCTOR = /* @__PURE__ */ ITERATOR_CONSTRUCTOR.toString();
const ASYNC_ITERATOR_CONSTRUCTOR = (symbol: symbol, createPromise: () => SV.Deferred) => (stream: InstanceType<typeof Stream>) => () => {
	let count: SV.Count = 0;
	let doneAt: number = -1;
	let isThrow = false;
	const buffer: SV.Given[] = [];
	const pending: SV.Deferred[] = [];
	const internal = { finalize(i: number = 0, len: number = pending.length): void {
		for (; i < len; i++) /*$*/(/*$*/pending[i].s/*$*/ as SV.SettleStep)/*$*/({
			done: true,
			value: void 0
		});
	} };
	stream.on({
		next(value: SV.Given): void {
			const temp = pending.shift();
			if (temp) /*$*/(/*$*/temp.s/*$*/ as SV.SettleStep)/*$*/({
				done: false,
				value
			});
			buffer.push(value);
		},
		throw(value: SV.Given): void {
			const temp = pending.shift();
			if (temp) /*$*/(/*$*/temp.f/*$*/ as SV.Settle)/*$*/(value);
			internal.finalize();
			doneAt = buffer.length;
			isThrow = true;
			buffer.push(value);
		},
		return(value: SV.Given): void {
			const temp = pending.shift();
			if (temp) /*$*/(/*$*/temp.s/*$*/ as SV.SettleStep)/*$*/({
				done: true,
				value
			});
			internal.finalize();
			doneAt = buffer.length;
			buffer.push(value);
		}
	});
	const instance: SV.Deserialized = {
		[symbol]() {
			return instance;
		},
		next(): SV.IteratorStep | SV.Deferred["p"] {
			if (doneAt === -1) {
				const index = count++;
				if (index >= buffer.length) {
					const temp = createPromise();
					pending.push(temp);
					return temp.p;
				}
				return {
					done: false,
					value: buffer[index]
				};
			}
			if (count > doneAt) return {
				done: true,
				value: void 0
			};
			const index = count++;
			const value = buffer[index];
			if (index !== doneAt) return {
				done: false,
				value
			};
			if (isThrow) throw value;
			return {
				done: true,
				value
			};
		}
	};
	return instance;
};
const SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR = /* @__PURE__ */ ASYNC_ITERATOR_CONSTRUCTOR.toString();
const ARRAY_BUFFER_CONSTRUCTOR = (b64: string) => {
	const decoded = atob(b64);
	const length = decoded.length;
	const arr = new Uint8Array(length);
	for (let i = 0; i < length; i++) arr[i] = decoded.charCodeAt(i);
	return arr.buffer;
};
const SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR = /* @__PURE__ */ ARRAY_BUFFER_CONSTRUCTOR.toString();
//#endregion
//#region src/core/sequence.ts
/**
* An internal class rather than a tagged POJO: identity is checked with
* `instanceof`, which untrusted input cannot forge (the class is not exported).
* The eval-based `deserialize` path still rebuilds a `{__SEROVAL_SEQUENCE__…}`
* POJO from embedded source - it has no access to this class - so a value read
* back through `deserialize` is not an instance and, by design, is not treated
* as a genuine Sequence on re-serialization.
*/
var Sequence = class { /*$*/declare v: SV.Given[]; declare t: SV.SequenceIndex; declare d: SV.SequenceIndex;/*$*/
	constructor(values: SV.Given[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex) {
		this.v = values;
		this.t = throwAt;
		this.d = doneAt;
	}
};
function isSequence(value: SV.Given): value is InstanceType<typeof Sequence> {
	return value instanceof Sequence;
}
function createSequence(values: SV.Given[], throwAt: SV.SequenceIndex, doneAt: SV.SequenceIndex) {
	return new Sequence(values, throwAt, doneAt);
}
function createSequenceFromIterable(source: SV.Given) {
	const values: SV.Given[] = [];
	let throwsAt: SV.SequenceIndex = -1;
	let doneAt: SV.SequenceIndex = -1;
	const iterator: SV.Given = source[SYM_ITERATOR]();
	while (true) try {
		const value: SV.Given = iterator.next();
		values.push(value.value);
		if (value.done) {
			doneAt = values.length - 1;
			break;
		}
	} catch (error: SV.Thrown) {
		throwsAt = values.length;
		doneAt = throwsAt;
		values.push(error);
		break;
	}
	return createSequence(values, throwsAt, doneAt);
}
const createIterator = ITERATOR_CONSTRUCTOR(SYM_ITERATOR);
function sequenceToIterator(sequence: InstanceType<typeof Sequence>) {
	return createIterator(sequence);
}
//#endregion
//#region src/core/special-reference.ts
const ITERATOR = {};
const ASYNC_ITERATOR = {};
/**
* Placeholder references
*/
const SPECIAL_REFS: SV.TokenTable = {
	[0]: {},
	[1]: {},
	[2]: {},
	[3]: {},
	[4]: {},
	[5]: {}
};
const SPECIAL_REF_STRING: SV.StringTable = {
	[0]: "[]",
	[1]: SERIALIZED_PROMISE_CONSTRUCTOR,
	[2]: SERIALIZED_PROMISE_SUCCESS,
	[3]: SERIALIZED_PROMISE_FAILURE,
	[4]: SERIALIZED_STREAM_CONSTRUCTOR,
	[5]: SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR
};
//#endregion
//#region src/core/stream.ts
/**
* An internal class rather than a tagged POJO: identity is checked with
* `instanceof`, which untrusted input cannot forge (the class is not exported).
*
* The behavior is intentionally duplicated from `STREAM_CONSTRUCTOR`. That
* constructor's source is embedded verbatim into the eval-based `deserialize`
* output, which has no access to this class, so the two cannot be shared. A
* stream read back through `deserialize` is therefore a plain POJO and, by
* design, is not treated as a genuine Stream on re-serialization. Keep the two
* implementations in sync.
*/
var Stream = class { /*$*/declare buffer: SV.Given[]; declare listeners: SV.StreamListener[]; declare alive: boolean; declare success: boolean; declare count: SV.Count;/*$*/
	constructor() {
		this.buffer = [];
		this.listeners = [];
		this.alive = true;
		this.success = false;
		this.count = 0;
	}
	flush(value: SV.Given, mode: SV.StreamEvent): void {
		for (let x = 0; x < this.count; x++) {
			var _this$listeners$x: SV.StreamListener;
			(_this$listeners$x = this.listeners[x]) === null || _this$listeners$x === void 0 || _this$listeners$x[mode](value);
		}
	}
	replay(listener: SV.StreamListener): void {
		for (let x = 0, z = this.buffer.length; x < z; x++) {
			const current = this.buffer[x];
			if (!this.alive && x === z - 1) listener[this.success ? "return" : "throw"](current);
			else listener.next(current);
		}
	}
	on(listener: SV.StreamListener): SV.Cleanup {
		let subscribed = this.alive;
		let temp: SV.Count = 0;
		if (subscribed) {
			for (; temp < this.count; temp++) if (!this.listeners[temp]) break;
			if (temp === this.count) this.count++;
			this.listeners[temp] = listener;
		}
		this.replay(listener);
		return () => {
			if (this.alive && subscribed) {
				subscribed = false;
				this.listeners[temp] = void 0;
				while (this.count > 0 && !this.listeners[this.count - 1]) this.count--;
				this.listeners.length = this.count;
			}
		};
	}
	next(value: SV.Given): void {
		if (this.alive) {
			this.buffer.push(value);
			this.flush(value, "next");
		}
	}
	throw(value: SV.Given): void {
		if (this.alive) {
			this.buffer.push(value);
			this.flush(value, "throw");
			this.alive = false;
			this.success = false;
			this.listeners.length = 0;
		}
	}
	return(value: SV.Given): void {
		if (this.alive) {
			this.buffer.push(value);
			this.flush(value, "return");
			this.alive = false;
			this.success = true;
			this.listeners.length = 0;
		}
	}
};
function isStream(value: SV.Given): value is InstanceType<typeof Stream> {
	return value instanceof Stream;
}
function createStream() {
	return new Stream();
}
function createStreamFromAsyncIterable(iterable: SV.Given, cleanups?: SV.Cleanup[]) {
	const stream = createStream();
	const iterator: SV.Given = iterable[SYM_ASYNC_ITERATOR]();
	let cancelled = false;
	let done = false;
	cleanups === null || cleanups === void 0 || cleanups.push(() => {
		if (!(done || cancelled)) {
			cancelled = true;
			Promise.resolve().then(() => {
				var _iterator$return: SV.Given;
				return (_iterator$return = iterator.return) === null || _iterator$return === void 0 ? void 0 : _iterator$return.call(iterator);
			}).catch(() => {});
		}
	});
	async function push(): Promise<void> {
		try {
			while (!cancelled) {
				const value: SV.Given = await iterator.next();
				if (cancelled) return;
				if (value.done) {
					done = true;
					stream.return(value.value);
					break;
				}
				stream.next(value.value);
			}
		} catch (error: SV.Thrown) {
			done = true;
			if (!cancelled) stream.throw(error);
		}
	}
	push().catch(() => {});
	return stream;
}
const createAsyncIterable = ASYNC_ITERATOR_CONSTRUCTOR(SYM_ASYNC_ITERATOR, PROMISE_CONSTRUCTOR);
function streamToAsyncIterable(stream: InstanceType<typeof Stream>) {
	return createAsyncIterable(stream);
}
//#endregion
//#region src/core/utils/promise-to-result.ts
async function promiseToResult(current: SV.Given): Promise<SV.PromiseResult> {
	try {
		return [1, await current];
	} catch (e: SV.Thrown) {
		return [0, e];
	}
}
//#endregion
//#region src/core/context/parser.ts
function createBaseParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.BaseParserContext {
	var _options$compactArray: SV.GivenFlag;
	return {
		plugins: options.plugins,
		mode,
		marked: /* @__PURE__ */ new Set(),
		features: 127 ^ (options.disabledFeatures || 0),
		refs: options.refs || /* @__PURE__ */ new Map(),
		depthLimit: options.depthLimit || 1e3,
		compactArrayBufferViews: (_options$compactArray = options.compactArrayBufferViews) !== null && _options$compactArray !== void 0 ? _options$compactArray : false
	};
}
/**
* Ensures that the value (based on an identifier) has been visited by the parser.
* @param ctx
* @param id
*/
function markParserRef(ctx: SV.BaseParserContext, id: SV.RefId): void {
	ctx.marked.add(id);
}
/**
* Creates an identifier for a value
* @param ctx
* @param current
*/
function createIndexForValue(ctx: SV.BaseParserContext, current: SV.Given): SV.RefId {
	const id: SV.RefId = ctx.refs.size;
	ctx.refs.set(current, id);
	return id;
}
function getNodeForIndexedValue(ctx: SV.BaseParserContext, current: SV.Given): SV.ParsedRef {
	const registeredId = ctx.refs.get(current);
	if (registeredId != null) {
		markParserRef(ctx, registeredId);
		return {
			type: 1,
			value: createIndexedValueNode(registeredId)
		};
	}
	return {
		type: 0,
		value: createIndexForValue(ctx, current)
	};
}
function getReferenceNode(ctx: SV.BaseParserContext, current: SV.Given): SV.ParsedRef {
	const indexed = getNodeForIndexedValue(ctx, current);
	if (indexed.type === 1) return indexed;
	if (hasReferenceID(current)) return {
		type: 2,
		value: createReferenceNode(indexed.value/*$*/ as SV.RefId/*$*/, current)
	};
	return indexed;
}
/**
* Parsing methods
*/
function parseWellKnownSymbol(ctx: SV.BaseParserContext, current: symbol): SV.SerovalNode {
	const ref = getReferenceNode(ctx, current);
	if (ref.type !== 0) return ref.value/*$*/ as SV.SerovalNode/*$*/;
	if (current in INV_SYMBOL_REF) return createWKSymbolNode(ref.value/*$*/ as SV.RefId/*$*/, current);
	throw new SerovalUnsupportedTypeError(current);
}
function parseSpecialReference(ctx: SV.BaseParserContext, ref: SV.SpecialRef): SV.SerovalNode {
	const result = getNodeForIndexedValue(ctx, SPECIAL_REFS[ref]);
	if (result.type === 1) return result.value/*$*/ as SV.SerovalNode/*$*/;
	return createSerovalNode(26, result.value/*$*/ as SV.RefId/*$*/, ref, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0);
}
function parseIteratorFactory(ctx: SV.BaseParserContext): SV.SerovalNode {
	const result = getNodeForIndexedValue(ctx, ITERATOR);
	if (result.type === 1) return result.value/*$*/ as SV.SerovalNode/*$*/;
	return createSerovalNode(27, result.value/*$*/ as SV.RefId/*$*/, void 0, void 0, void 0, void 0, void 0, void 0, parseWellKnownSymbol(ctx, SYM_ITERATOR), void 0, void 0, void 0);
}
function parseAsyncIteratorFactory(ctx: SV.BaseParserContext): SV.SerovalNode {
	const result = getNodeForIndexedValue(ctx, ASYNC_ITERATOR);
	if (result.type === 1) return result.value/*$*/ as SV.SerovalNode/*$*/;
	return createSerovalNode(29, result.value/*$*/ as SV.RefId/*$*/, void 0, void 0, void 0, void 0, void 0, [parseSpecialReference(ctx, 1), parseWellKnownSymbol(ctx, SYM_ASYNC_ITERATOR)], void 0, void 0, void 0, void 0);
}
function createObjectNode(id: SV.RefId, current: SV.Given, empty: boolean, record: SV.ObjectRecord): SV.SerovalNode {
	return createSerovalNode(empty ? 11 : 10, id, void 0, void 0, void 0, record, void 0, void 0, void 0, void 0, getObjectFlag(current), void 0);
}
function createMapNode(ctx: SV.BaseParserContext, id: SV.RefId, k: SV.SerovalNode[], v: SV.SerovalNode[]): SV.SerovalNode {
	return createSerovalNode(8, id, void 0, void 0, void 0, void 0, {
		k,
		v
	}, void 0, parseSpecialReference(ctx, 0), void 0, void 0, void 0);
}
function createPromiseConstructorNode(ctx: SV.BaseParserContext, id: SV.RefId, resolver: SV.RefId): SV.SerovalNode {
	return createSerovalNode(22, id, resolver, void 0, void 0, void 0, void 0, void 0, parseSpecialReference(ctx, 1), void 0, void 0, void 0);
}
function getArrayBufferView(ctx: SV.BaseParserContext, current: SV.Given): SV.Given {
	if (!ctx.compactArrayBufferViews) return current;
	const buffer = new Uint8Array(current.buffer, current.byteOffset, current.byteLength).slice().buffer;
	const Constructor: SV.GivenClass = current.constructor;
	return new Constructor(buffer);
}
function encodeArrayBuffer(current: SV.Given): string {
	if (typeof Buffer !== "undefined") return Buffer.from(current).toString("base64");
	const bytes = new Uint8Array(current);
	if (typeof /*$*/(/*$*/bytes/*$*/ as any)/*$*/.toBase64 === "function") return /*$*/(/*$*/bytes/*$*/ as any)/*$*/.toBase64();
	let result = "";
	for (let i = 0, len = bytes.length; i < len; i++) result += String.fromCharCode(bytes[i]);
	return btoa(result);
}
function createArrayBufferNode(ctx: SV.BaseParserContext, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	return createSerovalNode(19, id, encodeArrayBuffer(current), void 0, void 0, void 0, void 0, void 0, parseSpecialReference(ctx, 5), void 0, void 0, void 0);
}
//#endregion
//#region src/core/context/async-parser.ts
function createAsyncParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.AsyncParserContext {
	return {
		base: createBaseParserContext(mode, options),
		child: void 0
	};
}
var AsyncParsePluginContext = class { /*$*/declare _p: SV.AsyncParserContext; declare depth: SV.Depth;/*$*/
	constructor(_p: SV.AsyncParserContext, depth: SV.Depth) {
		this._p = _p;
		this.depth = depth;
	}
	parse(current: SV.Given): Promise<SV.SerovalNode> {
		return parseAsync(this._p, this.depth, current);
	}
};
async function parseItems$1(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given[]): Promise<SV.NodeItem[]> {
	const nodes: SV.NodeItem[] = [];
	for (let i = 0, len = current.length; i < len; i++) if (i in current) nodes[i] = await parseAsync(ctx, depth, current[i]);
	else nodes[i] = 0;
	return nodes;
}
async function parseArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given[]): Promise<SV.SerovalNode> {
	return createArrayNode(id, current, await parseItems$1(ctx, depth, current));
}
async function parseProperties$1(ctx: SV.AsyncParserContext, depth: SV.Depth, properties: SV.Given): Promise<SV.ObjectRecord> {
	const entries = Object.entries(properties);
	const keyNodes: SV.RecordKey[] = [];
	const valueNodes: SV.SerovalNode[] = [];
	for (let i = 0, len = entries.length; i < len; i++) {
		keyNodes.push(serializeString(entries[i][0]));
		valueNodes.push(await parseAsync(ctx, depth, entries[i][1]));
	}
	if (SYM_ITERATOR in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ITERATOR));
		valueNodes.push(createIteratorFactoryInstanceNode(parseIteratorFactory(ctx.base), await parseAsync(ctx, depth, createSequenceFromIterable(properties))));
	}
	if (SYM_ASYNC_ITERATOR in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ASYNC_ITERATOR));
		valueNodes.push(createAsyncIteratorFactoryInstanceNode(parseAsyncIteratorFactory(ctx.base), await parseAsync(ctx, depth, createStreamFromAsyncIterable(properties))));
	}
	if (SYM_TO_STRING_TAG in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_TO_STRING_TAG));
		valueNodes.push(createStringNode(properties[SYM_TO_STRING_TAG]));
	}
	if (SYM_IS_CONCAT_SPREADABLE in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_IS_CONCAT_SPREADABLE));
		valueNodes.push(properties[SYM_IS_CONCAT_SPREADABLE] ? TRUE_NODE : FALSE_NODE);
	}
	return {
		k: keyNodes,
		v: valueNodes
	};
}
async function parsePlainObject$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, empty: boolean): Promise<SV.SerovalNode> {
	return createObjectNode(id, current, empty, await parseProperties$1(ctx, depth, current));
}
async function parseBoxed$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	return createBoxedNode(id, await parseAsync(ctx, depth, current.valueOf()));
}
async function parseTypedArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	current = getArrayBufferView(ctx.base, current);
	return createTypedArrayNode(id, current, await parseAsync(ctx, depth, current.buffer));
}
async function parseBigIntTypedArray$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	current = getArrayBufferView(ctx.base, current);
	return createBigIntTypedArrayNode(id, current, await parseAsync(ctx, depth, current.buffer));
}
async function parseDataView$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	current = getArrayBufferView(ctx.base, current);
	return createDataViewNode(id, current, await parseAsync(ctx, depth, current.buffer));
}
async function parseError$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	const options = getErrorOptions(current, ctx.base.features);
	return createErrorNode(id, current, options ? await parseProperties$1(ctx, depth, options) : void 0);
}
async function parseAggregateError$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	const options = getErrorOptions(current, ctx.base.features);
	return createAggregateErrorNode(id, current, options ? await parseProperties$1(ctx, depth, options) : void 0);
}
async function parseMap$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	const keyNodes: SV.SerovalNode[] = [];
	const valueNodes: SV.SerovalNode[] = [];
	for (const [key, value] of current.entries()) {
		keyNodes.push(await parseAsync(ctx, depth, key));
		valueNodes.push(await parseAsync(ctx, depth, value));
	}
	return createMapNode(ctx.base, id, keyNodes, valueNodes);
}
async function parseSet$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	const items: SV.SerovalNode[] = [];
	for (const item of current.keys()) items.push(await parseAsync(ctx, depth, item));
	return createSetNode(id, items);
}
async function parsePlugin$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode | undefined> {
	const currentPlugins = ctx.base.plugins;
	if (currentPlugins) for (let i = 0, len = currentPlugins.length; i < len; i++) {
		const plugin: SV.Plugin = currentPlugins[i];
		if (plugin.parse.async && plugin.test(current)) return createPluginNode(id, plugin.tag, await plugin.parse.async(current, new AsyncParsePluginContext(ctx, depth), { id }));
	}
}
async function parsePromise$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	const [status, result] = await promiseToResult(current);
	return createSerovalNode(12, id, status, void 0, void 0, void 0, void 0, void 0, await parseAsync(ctx, depth, result), void 0, void 0, void 0);
}
function parseStreamHandle(this: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>, resolve: (sequence: SV.SerovalNode[]) => void, reject: (reason: SV.Thrown) => void): void {
	const sequence: SV.SerovalNode[] = [];
	const cleanup: SV.Cleanup = current.on({
		next: (value: SV.Given) => {
			markParserRef(this.base, id);
			parseAsync(this, depth, value).then((data: SV.SerovalNode) => {
				sequence.push(createStreamNextNode(id, data));
			}, (data: SV.Thrown) => {
				reject(data);
				cleanup();
			});
		},
		throw: (value: SV.Given) => {
			markParserRef(this.base, id);
			parseAsync(this, depth, value).then((data: SV.SerovalNode) => {
				sequence.push(createStreamThrowNode(id, data));
				resolve(sequence);
				cleanup();
			}, (data: SV.Thrown) => {
				reject(data);
				cleanup();
			});
		},
		return: (value: SV.Given) => {
			markParserRef(this.base, id);
			parseAsync(this, depth, value).then((data: SV.SerovalNode) => {
				sequence.push(createStreamReturnNode(id, data));
				resolve(sequence);
				cleanup();
			}, (data: SV.Thrown) => {
				reject(data);
				cleanup();
			});
		}
	});
}
async function parseStream$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>): Promise<SV.SerovalNode> {
	return createStreamConstructorNode(id, parseSpecialReference(ctx.base, 4), await new Promise<SV.SerovalNode[]>(parseStreamHandle.bind(ctx, depth, id, current)));
}
async function parseSequence$1(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Sequence>): Promise<SV.SerovalNode> {
	const nodes: SV.SerovalNode[] = [];
	for (let i = 0, len = current.v.length; i < len; i++) nodes[i] = await parseAsync(ctx, depth, current.v[i]);
	return createSequenceNode(id, nodes, current.t, current.d);
}
async function parseObjectAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): Promise<SV.SerovalNode> {
	if (Array.isArray(current)) return parseArray$1(ctx, depth, id, current);
	if (isStream(current)) return parseStream$1(ctx, depth, id, current);
	if (isSequence(current)) return parseSequence$1(ctx, depth, id, current);
	let currentClass: SV.GivenClass = current.constructor;
	if (currentClass !== void 0 && typeof currentClass !== "function") {
		const proto: SV.Given = Object.getPrototypeOf(current);
		currentClass = proto === null ? void 0 : proto.constructor;
	}
	if (currentClass === OpaqueReference) return parseAsync(ctx, depth, current.replacement);
	const parsed = await parsePlugin$1(ctx, depth, id, current);
	if (parsed) return parsed;
	switch (currentClass) {
		case Object: return parsePlainObject$1(ctx, depth, id, current, false);
		case void 0: return parsePlainObject$1(ctx, depth, id, current, true);
		case Date: return createDateNode(id, current);
		case Error:
		case EvalError:
		case RangeError:
		case ReferenceError:
		case SyntaxError:
		case TypeError:
		case URIError: return parseError$1(ctx, depth, id, current);
		case Number:
		case Boolean:
		case String:
		case BigInt: return parseBoxed$1(ctx, depth, id, current);
		case ArrayBuffer: return createArrayBufferNode(ctx.base, id, current);
		case Int8Array:
		case Int16Array:
		case Int32Array:
		case Uint8Array:
		case Uint16Array:
		case Uint32Array:
		case Uint8ClampedArray:
		case Float32Array:
		case Float64Array: return parseTypedArray$1(ctx, depth, id, current);
		case DataView: return parseDataView$1(ctx, depth, id, current);
		case Map: return parseMap$1(ctx, depth, id, current);
		case Set: return parseSet$1(ctx, depth, id, current);
	}
	if (currentClass === Promise || current instanceof Promise) return parsePromise$1(ctx, depth, id, current);
	const currentFeatures: SV.Features = ctx.base.features;
	if (currentFeatures & 32 && currentClass === RegExp) return createRegExpNode(id, current);
	if (currentFeatures & 16) switch (currentClass) {
		case BigInt64Array:
		case BigUint64Array: return parseBigIntTypedArray$1(ctx, depth, id, current);
	}
	if (currentFeatures & 1 && typeof AggregateError !== "undefined" && (currentClass === AggregateError || current instanceof AggregateError)) return parseAggregateError$1(ctx, depth, id, current);
	if (currentFeatures & 64 && typeof Temporal !== "undefined") switch (currentClass) {
		case Temporal.Instant: return createTemporalNode(id, 0, current);
		case Temporal.Duration: return createTemporalNode(id, 1, current);
		case Temporal.PlainDate: return createTemporalNode(id, 2, current);
		case Temporal.PlainDateTime: return createTemporalNode(id, 3, current);
		case Temporal.PlainMonthDay: return createTemporalNode(id, 4, current);
		case Temporal.PlainTime: return createTemporalNode(id, 5, current);
		case Temporal.PlainYearMonth: return createTemporalNode(id, 6, current);
		case Temporal.ZonedDateTime: return createTemporalNode(id, 7, current);
	}
	if (current instanceof Error) return parseError$1(ctx, depth, id, current);
	if (SYM_ITERATOR in current || SYM_ASYNC_ITERATOR in current) return parsePlainObject$1(ctx, depth, id, current, !!currentClass);
	throw new SerovalUnsupportedTypeError(current);
}
async function parseFunctionAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given): Promise<SV.SerovalNode> {
	const ref = getReferenceNode(ctx.base, current);
	if (ref.type !== 0) return ref.value/*$*/ as SV.SerovalNode/*$*/;
	const plugin = await parsePlugin$1(ctx, depth, ref.value/*$*/ as SV.RefId/*$*/, current);
	if (plugin) return plugin;
	throw new SerovalUnsupportedTypeError(current);
}
async function parseAsync(ctx: SV.AsyncParserContext, depth: SV.Depth, current: SV.Given): Promise<SV.SerovalNode> {
	if (depth >= ctx.base.depthLimit) throw new SerovalDepthLimitError(ctx.base.depthLimit);
	switch (typeof current) {
		case "boolean": return current ? TRUE_NODE : FALSE_NODE;
		case "undefined": return UNDEFINED_NODE;
		case "string": return createStringNode(current);
		case "number": return createNumberNode(current);
		case "bigint": return createBigIntNode(current);
		case "object":
			if (current) {
				const ref = getReferenceNode(ctx.base, current);
				return ref.type === 0 ? await parseObjectAsync(ctx, depth + 1, ref.value/*$*/ as SV.RefId/*$*/, current) : ref.value/*$*/ as SV.SerovalNode/*$*/;
			}
			return NULL_NODE;
		case "symbol": return parseWellKnownSymbol(ctx.base, current);
		case "function": return parseFunctionAsync(ctx, depth, current);
		default: throw new SerovalUnsupportedTypeError(current);
	}
}
async function parseTopAsync(ctx: SV.AsyncParserContext, current: SV.Given): Promise<SV.SerovalNode> {
	try {
		return await parseAsync(ctx, 0, current);
	} catch (error: SV.Thrown) {
		throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
	}
}
//#endregion
//#region src/core/plugin.ts
let SerovalMode = /* @__PURE__ */ function(SerovalMode: SV.EnumTable) {
	SerovalMode[SerovalMode["Vanilla"] = 1] = "Vanilla";
	SerovalMode[SerovalMode["Cross"] = 2] = "Cross";
	return SerovalMode;
}({});
function createPlugin(plugin: SV.Plugin): SV.Plugin {
	return plugin;
}
function dedupePlugins(deduped: Set<SV.Plugin>, plugins: SV.Plugins): void {
	for (let i = 0, len = plugins.length; i < len; i++) {
		const current: SV.Plugin = plugins[i];
		if (!deduped.has(current)) {
			deduped.add(current);
			if (current.extends) dedupePlugins(deduped, current.extends);
		}
	}
}
function resolvePlugins(plugins?: SV.Plugins): SV.Plugins | undefined {
	if (plugins) {
		const deduped = /* @__PURE__ */ new Set<SV.Plugin>();
		dedupePlugins(deduped, plugins);
		return [...deduped];
	}
}
//#endregion
//#region src/core/utils/typed-array.ts
function getTypedArrayConstructor(name: SV.GivenString) {
	switch (name) {
		case "Int8Array": return Int8Array;
		case "Int16Array": return Int16Array;
		case "Int32Array": return Int32Array;
		case "Uint8Array": return Uint8Array;
		case "Uint16Array": return Uint16Array;
		case "Uint32Array": return Uint32Array;
		case "Uint8ClampedArray": return Uint8ClampedArray;
		case "Float32Array": return Float32Array;
		case "Float64Array": return Float64Array;
		case "BigInt64Array": return BigInt64Array;
		case "BigUint64Array": return BigUint64Array;
		default: throw new SerovalUnknownTypedArrayError(name);
	}
}
//#endregion
//#region src/core/utils/valid-properties.ts
function isValidKey(key: string): boolean {
	switch (key) {
		case "constructor":
		case "__proto__":
		case "prototype":
		case "__defineGetter__":
		case "__defineSetter__":
		case "__lookupGetter__":
		case "__lookupSetter__": return false;
		default: return true;
	}
}
function isValidSymbol(symbol: symbol): boolean {
	switch (symbol) {
		case SYM_ASYNC_ITERATOR:
		case SYM_IS_CONCAT_SPREADABLE:
		case SYM_TO_STRING_TAG:
		case SYM_ITERATOR: return true;
		default: return false;
	}
}
//#endregion
//#region src/core/context/deserializer.ts
const DEFAULT_MAX_BASE64_LENGTH = 1e6;
const MIN_NATIVE_BASE64_LENGTH = 512;
const MAX_BIGINT_LENGTH = 1e4;
const MAX_REGEXP_SOURCE_LENGTH = 2e4;
function applyObjectFlag(obj: any[] | SV.MadeObject, flag: SV.Given): SV.Deserialized {
	switch (flag) {
		case 3: return Object.freeze(obj);
		case 1: return Object.preventExtensions(obj);
		case 2: return Object.seal(obj);
		default: return obj;
	}
}
const DEFAULT_DEPTH_LIMIT = 1e3;
function createBaseDeserializerContext(mode: SV.Mode, options: SV.DeserializerOptions): SV.BaseDeserializerContext {
	var _options$maxBase64Len: SV.GivenNumber, _options$features: SV.GivenNumber;
	const maxBase64Length: SV.GivenNumber = (_options$maxBase64Len = options.maxBase64Length) !== null && _options$maxBase64Len !== void 0 ? _options$maxBase64Len : DEFAULT_MAX_BASE64_LENGTH;
	if (!Number.isSafeInteger(maxBase64Length) || maxBase64Length < 0) throw new RangeError("maxBase64Length must be a non-negative safe integer");
	const refs: SV.DeserializerRefs = options.refs || /* @__PURE__ */ new Map();
	if (!("types" in refs)) Object.assign(refs, { types: /* @__PURE__ */ new Map<SV.GivenId, SV.NodeType>() });
	return {
		mode,
		plugins: options.plugins,
		refs,
		features: (_options$features = options.features) !== null && _options$features !== void 0 ? _options$features : 127 ^ (options.disabledFeatures || 0),
		depthLimit: options.depthLimit || DEFAULT_DEPTH_LIMIT,
		maxBase64Length
	};
}
function createVanillaDeserializerContext(options: SV.DeserializerOptions): SV.DeserializerContext {
	return {
		mode: 1,
		base: createBaseDeserializerContext(1, options),
		child: void 0,
		state: { marked: new Set(options.markedRefs) }
	};
}
function createCrossDeserializerContext(options: SV.DeserializerOptions): SV.DeserializerContext {
	return {
		mode: 2,
		base: createBaseDeserializerContext(2, options),
		child: void 0
	};
}
var DeserializePluginContext = class { /*$*/declare _p: SV.DeserializerContext; declare depth: SV.Depth;/*$*/
	constructor(_p: SV.DeserializerContext, depth: SV.Depth) {
		this._p = _p;
		this.depth = depth;
	}
	deserialize(node: SV.GivenNode): SV.Deserialized {
		return deserialize$1(this._p, this.depth, node);
	}
};
function guardIndexedValue(ctx: SV.BaseDeserializerContext, id: SV.GivenId): void {
	if (id < 0 || !Number.isFinite(id) || !Number.isInteger(id)) throw new SerovalMalformedNodeError({
		t: 4,
		i: id
	});
	if (ctx.refs.has(id)) throw new Error("Conflicted ref id: " + id);
}
function isThennable(value: SV.Deserialized): boolean {
	return !!value && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function";
}
function assignIndexedValueVanilla<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T {
	guardIndexedValue(ctx.base, id);
	if (ctx.state!.marked.has(id)) ctx.base.refs.set(id, value);
	return value;
}
function assignIndexedValueCross<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T {
	guardIndexedValue(ctx.base, id);
	ctx.base.refs.set(id, value);
	return value;
}
function assignIndexedValue$1<T>(ctx: SV.DeserializerContext, id: SV.GivenId, value: T): T {
	return ctx.mode === 1 ? assignIndexedValueVanilla(ctx, id, value) : assignIndexedValueCross(ctx, id, value);
}
function deserializeKnownValue(node: SV.GivenNode, record: SV.KnownValues, key: SV.Given): SV.Deserialized {
	if (/*$*/(/*$*/Object/*$*/ as any)/*$*/.hasOwn(record, key)) return record[key];
	throw new SerovalMalformedNodeError(node);
}
function deserializeReference(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	return assignIndexedValue$1(ctx, node.i, getReference(deserializeString(node.s)));
}
function validateNodeList(node: SV.GivenNode, list: SV.Given): void {
	if (!Array.isArray(list)) throw new SerovalMalformedNodeError(node);
}
function deserializeArray(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const items: SV.Given = node.a;
	validateNodeList(node, items);
	const len: number = items.length;
	const result = assignIndexedValue$1(ctx, node.i, new Array(len));
	for (let i = 0, item: SV.GivenNode; i < len; i++) {
		item = items[i];
		if (item) result[i] = deserialize$1(ctx, depth, item);
	}
	applyObjectFlag(result, node.o);
	return result;
}
function assignStringProperty(object: SV.Deserialized, key: string, value: SV.Deserialized): void {
	if (isValidKey(key)) object[key] = value;
	else Object.defineProperty(object, key, {
		value,
		configurable: true,
		enumerable: true,
		writable: true
	});
}
function assignProperty(ctx: SV.DeserializerContext, depth: SV.Depth, object: SV.Deserialized, key: SV.GivenNode, value: SV.GivenNode): void {
	if (typeof key === "string") assignStringProperty(object, deserializeString(key), deserialize$1(ctx, depth, value));
	else {
		const actual: SV.Deserialized = deserialize$1(ctx, depth, key);
		switch (typeof actual) {
			case "string":
				assignStringProperty(object, actual, deserialize$1(ctx, depth, value));
				break;
			case "symbol":
				if (isValidSymbol(actual)) object[actual] = deserialize$1(ctx, depth, value);
				break;
			default: throw new SerovalMalformedNodeError(key);
		}
	}
}
function assignNodeType(ctx: SV.DeserializerContext, id: SV.GivenId, type: SV.NodeType): void {
	/*$*/(/*$*/ctx.base.refs/*$*/ as any)/*$*/.types.set(id, type);
}
function validateNodeType(ctx: SV.DeserializerContext, node: SV.GivenNode, id: SV.GivenId, type: SV.NodeType): void {
	if (/*$*/(/*$*/ctx.base.refs/*$*/ as any)/*$*/.types.get(id) !== type) throw new SerovalMalformedNodeError(node);
}
function deserializeProperties(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenRecord, result: SV.Deserialized): SV.Deserialized {
	const keys = node.k;
	validateNodeList(node, keys);
	validateNodeList(node, node.v);
	if (keys.length > 0) for (let i = 0, vals = node.v, len = keys.length; i < len; i++) assignProperty(ctx, depth, result, keys[i], vals[i]);
	return result;
}
function deserializeObject(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const result: SV.Deserialized = assignIndexedValue$1<SV.Deserialized>(ctx, node.i, node.t === 10 ? {} : Object.create(null));
	deserializeProperties(ctx, depth, node.p, result);
	applyObjectFlag(result, node.o);
	return result;
}
function deserializeDate(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	return assignIndexedValue$1(ctx, node.i, new Date(node.s));
}
function deserializeTemporal(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	if (!(ctx.base.features & 64)) throw new SerovalUnsupportedNodeError(node);
	let value: SV.Deserialized;
	switch (node.c) {
		case 0:
			value = Temporal.Instant.from(node.s);
			break;
		case 1:
			value = Temporal.Duration.from(node.s);
			break;
		case 2:
			value = Temporal.PlainDate.from(node.s);
			break;
		case 3:
			value = Temporal.PlainDateTime.from(node.s);
			break;
		case 4:
			value = Temporal.PlainMonthDay.from(node.s);
			break;
		case 5:
			value = Temporal.PlainTime.from(node.s);
			break;
		case 6:
			value = Temporal.PlainYearMonth.from(node.s);
			break;
		case 7:
			value = Temporal.ZonedDateTime.from(node.s);
			break;
		default: throw new SerovalMalformedNodeError(node);
	}
	return assignIndexedValue$1(ctx, node.i, value);
}
function deserializeRegExp(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	if (ctx.base.features & 32) {
		const source = deserializeString(node.c);
		if (source.length > MAX_REGEXP_SOURCE_LENGTH) throw new SerovalMalformedNodeError(node);
		return assignIndexedValue$1(ctx, node.i, new RegExp(source, node.m));
	}
	throw new SerovalUnsupportedNodeError(node);
}
function deserializeSet(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const result = assignIndexedValue$1(ctx, node.i, /* @__PURE__ */ new Set<SV.Deserialized>());
	validateNodeList(node, node.a);
	for (let i = 0, items = node.a, len = items.length; i < len; i++) result.add(deserialize$1(ctx, depth, items[i]));
	return result;
}
function deserializeMap(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const result = assignIndexedValue$1(ctx, node.i, /* @__PURE__ */ new Map<SV.Deserialized, SV.Deserialized>());
	validateNodeList(node, node.e.k);
	validateNodeList(node, node.e.v);
	for (let i = 0, keys = node.e.k, vals = node.e.v, len = keys.length; i < len; i++) result.set(deserialize$1(ctx, depth, keys[i]), deserialize$1(ctx, depth, vals[i]));
	return result;
}
function deserializeArrayBuffer(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	if (typeof node.s !== "string") throw new SerovalMalformedNodeError(node);
	if (node.s.length > ctx.base.maxBase64Length) throw new RangeError("ArrayBuffer exceeds maxBase64Length (" + ctx.base.maxBase64Length + ")");
	const source = deserializeString(node.s);
	let buffer: ArrayBuffer;
	if (source.length < MIN_NATIVE_BASE64_LENGTH || typeof Buffer === "undefined") buffer = ARRAY_BUFFER_CONSTRUCTOR(source);
	else {
		const decoded = atob(source);
		buffer = new ArrayBuffer(decoded.length);
		Buffer.from(buffer).write(decoded, "latin1");
	}
	return assignIndexedValue$1(ctx, node.i, buffer);
}
function deserializeTypedArray(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	var _node$b: SV.GivenNumber;
	const construct = getTypedArrayConstructor(node.c);
	const source = deserialize$1(ctx, depth, node.f);
	if (!(source instanceof ArrayBuffer)) throw new SerovalMalformedNodeError(node);
	const offset = (_node$b = node.b) !== null && _node$b !== void 0 ? _node$b : 0;
	if (offset < 0 || offset > source.byteLength) throw new SerovalMalformedNodeError(node);
	return assignIndexedValue$1(ctx, node.i, new construct(source, offset, node.l));
}
function deserializeDataView(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	var _node$b2: SV.GivenNumber;
	const source = deserialize$1(ctx, depth, node.f);
	if (!(source instanceof ArrayBuffer)) throw new SerovalMalformedNodeError(node);
	const offset = (_node$b2 = node.b) !== null && _node$b2 !== void 0 ? _node$b2 : 0;
	if (offset < 0 || offset > source.byteLength) throw new SerovalMalformedNodeError(node);
	return assignIndexedValue$1(ctx, node.i, new DataView(source, offset, node.l));
}
function deserializeDictionary(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode, result: SV.Deserialized): SV.Deserialized {
	if (node.p) {
		const fields = deserializeProperties(ctx, depth, node.p, {});
		Object.defineProperties(result, Object.getOwnPropertyDescriptors(fields));
	}
	return result;
}
function deserializeAggregateError(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	return deserializeDictionary(ctx, depth, node, assignIndexedValue$1(ctx, node.i, new AggregateError([], deserializeString(node.m))));
}
function deserializeError(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const construct = deserializeKnownValue(node, ERROR_CONSTRUCTOR, node.s);
	return deserializeDictionary(ctx, depth, node, assignIndexedValue$1(ctx, node.i, new construct(deserializeString(node.m))));
}
function deserializePromise(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const deferred = PROMISE_CONSTRUCTOR();
	const result = assignIndexedValue$1(ctx, node.i, deferred.p);
	const deserialized = deserialize$1(ctx, depth, node.f);
	if (isThennable(deserialized)) throw new SerovalMalformedNodeError(node.f);
	if (node.s) /*$*/(/*$*/deferred.s/*$*/ as SV.Settle)/*$*/(deserialized);
	else /*$*/(/*$*/deferred.f/*$*/ as SV.Settle)/*$*/(deserialized);
	return result;
}
function deserializeBoxed(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	return assignIndexedValue$1(ctx, node.i, Object(deserialize$1(ctx, depth, node.f)));
}
function deserializePlugin(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const currentPlugins = ctx.base.plugins;
	if (currentPlugins) {
		const tag = deserializeString(node.c);
		for (let i = 0, len = currentPlugins.length; i < len; i++) {
			const plugin = currentPlugins[i];
			if (plugin.tag === tag) return assignIndexedValue$1(ctx, node.i, plugin.deserialize(node.s, new DeserializePluginContext(ctx, depth), { id: node.i }));
		}
	}
	throw new SerovalMissingPluginError(node.c);
}
function deserializePromiseConstructor(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	const value = assignIndexedValue$1(ctx, node.i, assignIndexedValue$1(ctx, node.s, PROMISE_CONSTRUCTOR()).p);
	assignNodeType(ctx, node.s, 22);
	return value;
}
function deserializePromiseFulfill(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	const deferred = ctx.base.refs.get(node.i);
	if (deferred) {
		validateNodeType(ctx, node, node.i, 22);
		const deserialized = deserialize$1(ctx, depth, node.a[1]);
		if (isThennable(deserialized)) throw new SerovalMalformedNodeError(node.a[1]);
		if (node.t === 23) deferred.s(deserialized);
		else deferred.f(deserialized);
		return;
	}
	throw new SerovalMissingInstanceError("Promise");
}
function deserializeIteratorFactoryInstance(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	deserialize$1(ctx, depth, node.a[0]);
	const source = deserialize$1(ctx, depth, node.a[1]);
	if (!isSequence(source)) throw new SerovalMalformedNodeError(node.a[1]);
	return sequenceToIterator(source);
}
function deserializeAsyncIteratorFactoryInstance(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	deserialize$1(ctx, depth, node.a[0]);
	const source = deserialize$1(ctx, depth, node.a[1]);
	if (!isStream(source)) throw new SerovalMalformedNodeError(node.a[1]);
	return streamToAsyncIterable(source);
}
function deserializeStreamConstructor(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	const result = assignIndexedValue$1(ctx, node.i, createStream());
	assignNodeType(ctx, node.i, 31);
	const items = node.a;
	validateNodeList(node, items);
	const len = items.length;
	if (len) for (let i = 0; i < len; i++) deserialize$1(ctx, depth, items[i]);
	return result;
}
function deserializeStreamNext(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	const deferred = ctx.base.refs.get(node.i);
	if (deferred) {
		validateNodeType(ctx, node, node.i, 31);
		deferred.next(deserialize$1(ctx, depth, node.f));
		return;
	}
	throw new SerovalMissingInstanceError("Stream");
}
function deserializeStreamThrow(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	const deferred = ctx.base.refs.get(node.i);
	if (deferred) {
		validateNodeType(ctx, node, node.i, 31);
		deferred.throw(deserialize$1(ctx, depth, node.f));
		return;
	}
	throw new SerovalMissingInstanceError("Stream");
}
function deserializeStreamReturn(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	const deferred = ctx.base.refs.get(node.i);
	if (deferred) {
		validateNodeType(ctx, node, node.i, 31);
		deferred.return(deserialize$1(ctx, depth, node.f));
		return;
	}
	throw new SerovalMissingInstanceError("Stream");
}
function deserializeIteratorFactory(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	deserialize$1(ctx, depth, node.f);
}
function deserializeAsyncIteratorFactory(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): void {
	deserialize$1(ctx, depth, node.a[1]);
}
function isSequenceIndex(value: SV.Given, size: number): boolean {
	return Number.isInteger(value) && value >= -1 && value < size;
}
function deserializeSequence(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	validateNodeList(node, node.a);
	const size = node.a.length;
	if (!(isSequenceIndex(node.s, size) && isSequenceIndex(node.l, size))) throw new SerovalMalformedNodeError(node);
	const result = assignIndexedValue$1(ctx, node.i, createSequence([], node.s, node.l));
	for (let i = 0; i < size; i++) result.v[i] = deserialize$1(ctx, depth, node.a[i]);
	return result;
}
function deserialize$1(ctx: SV.DeserializerContext, depth: SV.Depth, node: SV.GivenNode): SV.Deserialized {
	if (depth > ctx.base.depthLimit) throw new SerovalDepthLimitError(ctx.base.depthLimit);
	depth += 1;
	switch (node.t) {
		case 2: return deserializeKnownValue(node, CONSTANT_VAL, node.s);
		case 0: return Number(node.s);
		case 1: return deserializeString(String(node.s));
		case 3:
			if (String(node.s).length > MAX_BIGINT_LENGTH) throw new SerovalMalformedNodeError(node);
			return BigInt(node.s);
		case 4: return ctx.base.refs.get(node.i);
		case 18: return deserializeReference(ctx, node);
		case 9: return deserializeArray(ctx, depth, node);
		case 10:
		case 11: return deserializeObject(ctx, depth, node);
		case 5: return deserializeDate(ctx, node);
		case 6: return deserializeRegExp(ctx, node);
		case 7: return deserializeSet(ctx, depth, node);
		case 8: return deserializeMap(ctx, depth, node);
		case 19: return deserializeArrayBuffer(ctx, node);
		case 16:
		case 15: return deserializeTypedArray(ctx, depth, node);
		case 20: return deserializeDataView(ctx, depth, node);
		case 14: return deserializeAggregateError(ctx, depth, node);
		case 13: return deserializeError(ctx, depth, node);
		case 12: return deserializePromise(ctx, depth, node);
		case 17: return deserializeKnownValue(node, SYMBOL_REF, node.s);
		case 21: return deserializeBoxed(ctx, depth, node);
		case 25: return deserializePlugin(ctx, depth, node);
		case 22: return deserializePromiseConstructor(ctx, node);
		case 23:
		case 24: return deserializePromiseFulfill(ctx, depth, node);
		case 28: return deserializeIteratorFactoryInstance(ctx, depth, node);
		case 30: return deserializeAsyncIteratorFactoryInstance(ctx, depth, node);
		case 31: return deserializeStreamConstructor(ctx, depth, node);
		case 32: return deserializeStreamNext(ctx, depth, node);
		case 33: return deserializeStreamThrow(ctx, depth, node);
		case 34: return deserializeStreamReturn(ctx, depth, node);
		case 27: return deserializeIteratorFactory(ctx, depth, node);
		case 29: return deserializeAsyncIteratorFactory(ctx, depth, node);
		case 35: return deserializeSequence(ctx, depth, node);
		case 36: return deserializeTemporal(ctx, node);
		default: throw new SerovalUnsupportedNodeError(node);
	}
}
function deserializeTop(ctx: SV.DeserializerContext, node: SV.GivenNode): SV.Deserialized {
	try {
		return deserialize$1(ctx, 0, node);
	} catch (error: SV.Thrown) {
		throw new SerovalDeserializationError(error);
	}
}
//#endregion
//#region src/core/function-string.ts
const RETURN = () => T;
const SERIALIZED_RETURN = /* @__PURE__ */ RETURN.toString();
const IS_MODERN = /* @__PURE__ */ /=>/.test(SERIALIZED_RETURN);
function createFunction(parameters: string[], body: string): string {
	if (IS_MODERN) return (parameters.length === 1 ? parameters[0] : "(" + parameters.join(",") + ")") + "=>" + (body.startsWith("{") ? "(" + body + ")" : body);
	return "function(" + parameters.join(",") + "){return " + body + "}";
}
function createEffectfulFunction(parameters: string[], body: string): string {
	if (IS_MODERN) return (parameters.length === 1 ? parameters[0] : "(" + parameters.join(",") + ")") + "=>{" + body + "}";
	return "function(" + parameters.join(",") + "){" + body + "}";
}
//#endregion
//#region src/core/utils/get-identifier.ts
const REF_START_CHARS = "hjkmoquxzABCDEFGHIJKLNPQRTUVWXYZ$_";
const REF_START_CHARS_LEN = 34;
const REF_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$_";
const REF_CHARS_LEN = 64;
function getIdentifier(index: number): string {
	let mod = index % REF_START_CHARS_LEN;
	let ref = REF_START_CHARS[mod];
	index = (index - mod) / REF_START_CHARS_LEN;
	while (index > 0) {
		mod = index % REF_CHARS_LEN;
		ref += REF_CHARS[mod];
		index = (index - mod) / REF_CHARS_LEN;
	}
	return ref;
}
//#endregion
//#region src/core/utils/is-valid-identifier.ts
const IDENTIFIER_CHECK = /^[$A-Z_][0-9A-Z_$]*$/i;
function isValidIdentifier(name: string): boolean {
	const char: string | undefined = name[0];
	return (char === "$" || char === "_" || char >= "A" && char <= "Z" || char >= "a" && char <= "z") && IDENTIFIER_CHECK.test(name);
}
//#endregion
//#region src/core/context/serializer.ts
function getAssignmentExpression(assignment: SV.Assignment): string | undefined {
	switch (assignment.t) {
		case 0: return assignment.s + "=" + assignment.v;
		case 2: return assignment.s + ".set(" + assignment.k + "," + assignment.v + ")";
		case 1: return assignment.s + ".add(" + assignment.v + ")";
		case 3: return assignment.s + ".delete(" + assignment.k + ")";
		case 4: return "Object.defineProperty(" + assignment.s + ",\"__proto__\",{value:" + assignment.k + ",configurable:!0,enumerable:!0,writable:!0})";
	}
}
function mergeAssignments(assignments: SV.Assignment[]): SV.Assignment[] {
	const newAssignments: SV.Assignment[] = [];
	let current: SV.Assignment = assignments[0];
	for (let i = 1, len = assignments.length, item: SV.Assignment, prev: SV.Assignment = current; i < len; i++) {
		item = assignments[i];
		if (item.t === 0 && item.v === prev.v) current = {
			t: 0,
			s: item.s,
			k: void 0,
			v: getAssignmentExpression(current)
		};
		else if (item.t === 2 && item.s === prev.s) current = {
			t: 2,
			s: getAssignmentExpression(current)!,
			k: item.k,
			v: item.v
		};
		else if (item.t === 1 && item.s === prev.s) current = {
			t: 1,
			s: getAssignmentExpression(current)!,
			k: void 0,
			v: item.v
		};
		else if (item.t === 3 && item.s === prev.s) current = {
			t: 3,
			s: getAssignmentExpression(current)!,
			k: item.k,
			v: void 0
		};
		else {
			newAssignments.push(current);
			current = item;
		}
		prev = item;
	}
	newAssignments.push(current);
	return newAssignments;
}
function resolveAssignments(assignments: SV.Assignment[]): string | undefined {
	if (assignments.length) {
		let result = "";
		const merged = mergeAssignments(assignments);
		for (let i = 0, len = merged.length; i < len; i++) result += getAssignmentExpression(merged[i]) + ",";
		return result;
	}
}
const NULL_CONSTRUCTOR = "Object.create(null)";
const SET_CONSTRUCTOR = "new Set";
const MAP_CONSTRUCTOR = "new Map";
const PROMISE_RESOLVE = "Promise.resolve";
const PROMISE_REJECT = "Promise.reject";
const OBJECT_FLAG_CONSTRUCTOR: SV.FlagTable = {
	[3]: "Object.freeze",
	[2]: "Object.seal",
	[1]: "Object.preventExtensions",
	[0]: void 0
};
function createBaseSerializerContext(mode: SV.Mode, options: SV.SerializerOptions): SV.BaseSerializerContext {
	return {
		mode,
		plugins: options.plugins,
		features: options.features,
		marked: new Set(options.markedRefs),
		stack: [],
		flags: [],
		assignments: []
	};
}
function createVanillaSerializerState(): SV.VanillaSerializerState {
	return {
		valid: /* @__PURE__ */ new Map(),
		vars: []
	};
}
function createVanillaSerializerContext(options: SV.SerializerOptions): SV.SerializerContext {
	return {
		mode: 1,
		base: createBaseSerializerContext(1, options),
		state: createVanillaSerializerState(),
		child: void 0
	};
}
function createCrossSerializerContext(options: SV.SerializerOptions): SV.SerializerContext {
	return {
		mode: 2,
		base: createBaseSerializerContext(2, options),
		state: options,
		child: void 0
	};
}
var SerializePluginContext = class { /*$*/declare _p: SV.SerializerContext;/*$*/
	constructor(_p: SV.SerializerContext) {
		this._p = _p;
	}
	serialize(node: SV.GivenNode): string {
		return serialize$1(this._p, node);
	}
};
/**
* Creates the reference param (identifier) from the given reference ID
* Calling this function means the value has been referenced somewhere
*/
function getVanillaRefParam(state: SV.VanillaSerializerState, index: SV.RefId): string {
	/**
	* Creates a new reference ID from a given reference ID
	* This new reference ID means that the reference itself
	* has been referenced at least once, and is used to generate
	* the variables
	*/
	let actualIndex: SV.Count | undefined = state.valid.get(index);
	if (actualIndex == null) {
		actualIndex = state.valid.size;
		state.valid.set(index, actualIndex);
	}
	let identifier: string | undefined = state.vars[actualIndex];
	if (identifier == null) {
		identifier = getIdentifier(actualIndex);
		state.vars[actualIndex] = identifier;
	}
	return identifier;
}
function getCrossRefParam(id: SV.RefId): string {
	return "$R[" + id + "]";
}
/**
* Converts the ID of a reference into a identifier string
* that is used to refer to the object instance in the
* generated script.
*/
function getRefParam(ctx: SV.SerializerContext, id: SV.RefId): string {
	return ctx.mode === 1 ? getVanillaRefParam(ctx.state/*$*/ as SV.VanillaSerializerState/*$*/, id) : getCrossRefParam(id);
}
function markSerializerRef(ctx: SV.BaseSerializerContext, id: SV.RefId): void {
	ctx.marked.add(id);
}
function isSerializerRefMarked(ctx: SV.BaseSerializerContext, id: SV.RefId): boolean {
	return ctx.marked.has(id);
}
function pushObjectFlag(ctx: SV.SerializerContext, flag: SV.ObjectFlag, id: SV.RefId): void {
	if (flag !== 0) {
		markSerializerRef(ctx.base, id);
		ctx.base.flags.push({
			type: flag,
			value: getRefParam(ctx, id)
		});
	}
}
function resolveFlags(ctx: SV.BaseSerializerContext): string {
	let result = "";
	for (let i = 0, current = ctx.flags, len = current.length; i < len; i++) {
		const flag = current[i];
		result += OBJECT_FLAG_CONSTRUCTOR[flag.type] + "(" + flag.value + "),";
	}
	return result;
}
function resolvePatches(ctx: SV.BaseSerializerContext): string {
	const assignments = resolveAssignments(ctx.assignments);
	const flags = resolveFlags(ctx);
	if (assignments) {
		if (flags) return assignments + flags;
		return assignments;
	}
	return flags;
}
/**
* Generates the inlined assignment for the reference
* This is different from the assignments array as this one
* signifies creation rather than mutation
*/
function createAssignment(ctx: SV.BaseSerializerContext, source: string, value: string): void {
	ctx.assignments.push({
		t: 0,
		s: source,
		k: void 0,
		v: value
	});
}
function createAddAssignment(ctx: SV.SerializerContext, ref: SV.RefId, value: string): void {
	ctx.base.assignments.push({
		t: 1,
		s: getRefParam(ctx, ref),
		k: void 0,
		v: value
	});
}
function createSetAssignment(ctx: SV.SerializerContext, ref: SV.RefId, key: string, value: string): void {
	ctx.base.assignments.push({
		t: 2,
		s: getRefParam(ctx, ref),
		k: key,
		v: value
	});
}
function createDeleteAssignment(ctx: SV.SerializerContext, ref: SV.RefId, key: string): void {
	ctx.base.assignments.push({
		t: 3,
		s: getRefParam(ctx, ref),
		k: key,
		v: void 0
	});
}
function createArrayAssign(ctx: SV.SerializerContext, ref: SV.RefId, index: string | number, value: string): void {
	createAssignment(ctx.base, getRefParam(ctx, ref) + "[" + index + "]", value);
}
function createObjectAssign(ctx: SV.SerializerContext, ref: SV.RefId, key: string, value: string): void {
	if (!isValidKey(key)) {
		ctx.base.assignments.push({
			t: 4,
			s: getRefParam(ctx, ref),
			k: value,
			v: void 0
		});
		return;
	}
	createAssignment(ctx.base, getRefParam(ctx, ref) + "." + key, value);
}
function createSequenceAssign(ctx: SV.SerializerContext, ref: SV.RefId, index: number, value: string): void {
	createAssignment(ctx.base, getRefParam(ctx, ref) + ".v[" + index + "]", value);
}
/**
* Checks if the value is in the stack. Stack here is a reference
* structure to know if a object is to be accessed in a TDZ.
*/
function isIndexedValueInStack(ctx: SV.BaseSerializerContext, node: SV.SerovalNode): boolean {
	return node.t === 4 && ctx.stack.includes(node.i!);
}
/**
* Produces an assignment expression. `id` generates a reference
* parameter (through `getRefParam`) and has the option to
* return the reference parameter directly or assign a value to
* it.
*/
function assignIndexedValue(ctx: SV.SerializerContext, index: SV.RefId, value: string): string {
	if (ctx.mode === 1 && !isSerializerRefMarked(ctx.base, index)) return value;
	/**
	* In cross-reference, we have to assume that
	* every reference are going to be referenced
	* in the future, and so we need to store
	* all of it into the reference array.
	*
	* otherwise in vanilla, we only do this if it
	* is actually referenced
	*/
	return getRefParam(ctx, index) + "=" + value;
}
function serializeReference(node: SV.SerovalNode): string {
	return "__SEROVAL_REFS__.get(\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\")";
}
function serializeArrayItem(ctx: SV.SerializerContext, id: SV.RefId, item: SV.NodeItem, index: number): string {
	if (item) {
		if (isIndexedValueInStack(ctx.base, item)) {
			markSerializerRef(ctx.base, id);
			createArrayAssign(ctx, id, index, getRefParam(ctx, item.i!));
			return "";
		}
		return serialize$1(ctx, item);
	}
	return "";
}
function serializeArray(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const id = node.i!;
	const list = node.a!;
	const len = list.length;
	if (len > 0) {
		ctx.base.stack.push(id);
		let values = serializeArrayItem(ctx, id, list[0], 0);
		let isHoley = values === "";
		for (let i: number = 1, item: string; i < len; i++) {
			item = serializeArrayItem(ctx, id, list[i], i);
			values += "," + item;
			isHoley = item === "";
		}
		ctx.base.stack.pop();
		pushObjectFlag(ctx, node.o!, node.i!);
		return "[" + values + (isHoley ? ",]" : "]");
	}
	return "[]";
}
function serializeProperty(ctx: SV.SerializerContext, source: SV.SerovalNode, key: SV.RecordKey, val: SV.SerovalNode): string {
	if (typeof key === "string") {
		const check = Number(key);
		const isIdentifier = check >= 0 && check.toString() === key || isValidIdentifier(key);
		if (isIndexedValueInStack(ctx.base, val)) {
			const refParam = getRefParam(ctx, val.i!);
			markSerializerRef(ctx.base, source.i!);
			if (isIdentifier && check !== check) createObjectAssign(ctx, source.i!, key, refParam);
			else createArrayAssign(ctx, source.i!, isIdentifier ? key : "\"" + key + "\"", refParam);
			return "";
		}
		if (isValidKey(key)) return (isIdentifier ? key : "\"" + key + "\"") + ":" + serialize$1(ctx, val);
		return "[\"" + key + "\"]:" + serialize$1(ctx, val);
	}
	return "[" + serialize$1(ctx, key) + "]:" + serialize$1(ctx, val);
}
function serializeProperties(ctx: SV.SerializerContext, source: SV.SerovalNode, record: SV.ObjectRecord): string {
	const keys = record.k;
	const len = keys.length;
	if (len > 0) {
		const values = record.v;
		ctx.base.stack.push(source.i!);
		let result = serializeProperty(ctx, source, keys[0], values[0]);
		for (let i = 1, item = result; i < len; i++) {
			item = serializeProperty(ctx, source, keys[i], values[i]);
			result += (item && result && ",") + item;
		}
		ctx.base.stack.pop();
		return "{" + result + "}";
	}
	return "{}";
}
function serializeObject(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	pushObjectFlag(ctx, node.o!, node.i!);
	return serializeProperties(ctx, node, node.p!);
}
function serializeWithObjectAssign(ctx: SV.SerializerContext, source: SV.SerovalNode, value: SV.ObjectRecord, serialized: string): string {
	const fields = serializeProperties(ctx, source, value);
	if (fields !== "{}") return "Object.assign(" + serialized + "," + fields + ")";
	return serialized;
}
function serializeStringKeyAssignment(ctx: SV.SerializerContext, source: SV.SerovalNode, mainAssignments: SV.Assignment[], key: string, value: SV.SerovalNode): void {
	const base = ctx.base;
	const serialized = serialize$1(ctx, value);
	const check = Number(key);
	const isIdentifier = check >= 0 && check.toString() === key || isValidIdentifier(key);
	if (isIndexedValueInStack(base, value)) {
		if (isIdentifier && check !== check) createObjectAssign(ctx, source.i!, key, serialized);
		else createArrayAssign(ctx, source.i!, isIdentifier ? key : "\"" + key + "\"", serialized);
	} else {
		const parentAssignment = base.assignments;
		base.assignments = mainAssignments;
		if (isIdentifier && check !== check) createObjectAssign(ctx, source.i!, key, serialized);
		else createArrayAssign(ctx, source.i!, isIdentifier ? key : "\"" + key + "\"", serialized);
		base.assignments = parentAssignment;
	}
}
function serializeAssignment(ctx: SV.SerializerContext, source: SV.SerovalNode, mainAssignments: SV.Assignment[], key: SV.RecordKey, value: SV.SerovalNode): void {
	if (typeof key === "string") serializeStringKeyAssignment(ctx, source, mainAssignments, key, value);
	else {
		const base = ctx.base;
		const parent = base.stack;
		base.stack = [];
		const serialized = serialize$1(ctx, value);
		base.stack = parent;
		const parentAssignment = base.assignments;
		base.assignments = mainAssignments;
		createArrayAssign(ctx, source.i!, serialize$1(ctx, key), serialized);
		base.assignments = parentAssignment;
	}
}
function serializeAssignments(ctx: SV.SerializerContext, source: SV.SerovalNode, node: SV.ObjectRecord): string | undefined {
	const keys = node.k;
	const len = keys.length;
	if (len > 0) {
		const mainAssignments: SV.Assignment[] = [];
		const values = node.v;
		ctx.base.stack.push(source.i!);
		for (let i = 0; i < len; i++) serializeAssignment(ctx, source, mainAssignments, keys[i], values[i]);
		ctx.base.stack.pop();
		return resolveAssignments(mainAssignments);
	}
}
function serializeDictionary(ctx: SV.SerializerContext, node: SV.SerovalNode, init: string): string {
	if (node.p) {
		const base = ctx.base;
		if (base.features & 8) init = serializeWithObjectAssign(ctx, node, node.p, init);
		else {
			markSerializerRef(base, node.i!);
			const assignments = serializeAssignments(ctx, node, node.p);
			if (assignments) return "(" + assignIndexedValue(ctx, node.i!, init) + "," + assignments + getRefParam(ctx, node.i!) + ")";
		}
	}
	return init;
}
function serializeNullConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	pushObjectFlag(ctx, node.o!, node.i!);
	return serializeDictionary(ctx, node, NULL_CONSTRUCTOR);
}
function serializeDate(node: SV.SerovalNode): string {
	return "new Date(\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\")";
}
const TEMPORAL_CONSTRUCTOR: SV.StringTable = {
	[0]: "Temporal.Instant",
	[1]: "Temporal.Duration",
	[2]: "Temporal.PlainDate",
	[3]: "Temporal.PlainDateTime",
	[4]: "Temporal.PlainMonthDay",
	[5]: "Temporal.PlainTime",
	[6]: "Temporal.PlainYearMonth",
	[7]: "Temporal.ZonedDateTime"
};
function serializeTemporal(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	if (ctx.base.features & 64) return TEMPORAL_CONSTRUCTOR[node.c/*$*/ as SV.TemporalType/*$*/] + ".from(\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\")";
	throw new SerovalUnsupportedNodeError(node);
}
function serializeRegExp(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	if (ctx.base.features & 32) return "/" + deserializeString(node.c) + "/" + node.m!;
	throw new SerovalUnsupportedNodeError(node);
}
function serializeSetItem(ctx: SV.SerializerContext, id: SV.RefId, item: SV.SerovalNode): string {
	const base = ctx.base;
	if (isIndexedValueInStack(base, item)) {
		markSerializerRef(base, id);
		createAddAssignment(ctx, id, getRefParam(ctx, item.i!));
		return "";
	}
	return serialize$1(ctx, item);
}
function serializeSet(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	let serialized = SET_CONSTRUCTOR;
	const items = node.a!;
	const size = items.length;
	const id = node.i!;
	if (size > 0) {
		ctx.base.stack.push(id);
		let result = serializeSetItem(ctx, id, items[0]/*$*/ as SV.SerovalNode/*$*/);
		for (let i = 1, item = result; i < size; i++) {
			item = serializeSetItem(ctx, id, items[i]/*$*/ as SV.SerovalNode/*$*/);
			result += (item && result && ",") + item;
		}
		ctx.base.stack.pop();
		if (result) serialized += "([" + result + "])";
	}
	return serialized;
}
function serializeMapEntry(ctx: SV.SerializerContext, id: SV.RefId, key: SV.SerovalNode, val: SV.SerovalNode, sentinel: string): string {
	const base = ctx.base;
	if (isIndexedValueInStack(base, key)) {
		const keyRef = getRefParam(ctx, key.i!);
		markSerializerRef(base, id);
		if (isIndexedValueInStack(base, val)) {
			createSetAssignment(ctx, id, keyRef, getRefParam(ctx, val.i!));
			return "";
		}
		if (val.t !== 4 && val.i != null && isSerializerRefMarked(base, val.i)) {
			const serialized = "(" + serialize$1(ctx, val) + ",[" + sentinel + "," + sentinel + "])";
			createSetAssignment(ctx, id, keyRef, getRefParam(ctx, val.i));
			createDeleteAssignment(ctx, id, sentinel);
			return serialized;
		}
		const parent = base.stack;
		base.stack = [];
		createSetAssignment(ctx, id, keyRef, serialize$1(ctx, val));
		base.stack = parent;
		return "";
	}
	if (isIndexedValueInStack(base, val)) {
		const valueRef = getRefParam(ctx, val.i!);
		markSerializerRef(base, id);
		if (key.t !== 4 && key.i != null && isSerializerRefMarked(base, key.i)) {
			const serialized = "(" + serialize$1(ctx, key) + ",[" + sentinel + "," + sentinel + "])";
			createSetAssignment(ctx, id, getRefParam(ctx, key.i), valueRef);
			createDeleteAssignment(ctx, id, sentinel);
			return serialized;
		}
		const parent = base.stack;
		base.stack = [];
		createSetAssignment(ctx, id, serialize$1(ctx, key), valueRef);
		base.stack = parent;
		return "";
	}
	return "[" + serialize$1(ctx, key) + "," + serialize$1(ctx, val) + "]";
}
function serializeMap(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	let serialized = MAP_CONSTRUCTOR;
	const keys = node.e!.k;
	const size = keys.length;
	const id = node.i!;
	const sentinel = node.f!;
	const sentinelId = getRefParam(ctx, sentinel.i!);
	const base = ctx.base;
	if (size > 0) {
		const vals = node.e!.v;
		base.stack.push(id);
		let result = serializeMapEntry(ctx, id, keys[0], vals[0], sentinelId);
		for (let i = 1, item = result; i < size; i++) {
			item = serializeMapEntry(ctx, id, keys[i], vals[i], sentinelId);
			result += (item && result && ",") + item;
		}
		base.stack.pop();
		if (result) serialized += "([" + result + "])";
	}
	if (sentinel.t === 26) {
		markSerializerRef(base, sentinel.i!);
		serialized = "(" + serialize$1(ctx, sentinel) + "," + serialized + ")";
	}
	return serialized;
}
function serializeArrayBuffer(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getConstructor(ctx, node.f!) + "(\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\")";
}
function serializeTypedArray(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return "new " + /*$*/(/*$*/node.c/*$*/ as string)/*$*/ + "(" + serialize$1(ctx, node.f!) + "," + node.b! + "," + node.l! + ")";
}
function serializeDataView(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return "new DataView(" + serialize$1(ctx, node.f!) + "," + node.b! + "," + node.l! + ")";
}
function serializeAggregateError(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const id = node.i!;
	ctx.base.stack.push(id);
	const serialized = serializeDictionary(ctx, node, "new AggregateError([],\"" + node.m! + "\")");
	ctx.base.stack.pop();
	return serialized;
}
function serializeError(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return serializeDictionary(ctx, node, "new " + ERROR_CONSTRUCTOR_STRING[node.s/*$*/ as SV.ErrorTag/*$*/] + "(\"" + node.m! + "\")");
}
function serializePromise(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	let serialized: string;
	const fulfilled = node.f!;
	const id = node.i!;
	const promiseConstructor = node.s ? PROMISE_RESOLVE : PROMISE_REJECT;
	const base = ctx.base;
	if (isIndexedValueInStack(base, fulfilled)) {
		const ref = getRefParam(ctx, fulfilled.i!);
		serialized = promiseConstructor + (node.s ? "().then(" + createFunction([], ref) + ")" : "().catch(" + createEffectfulFunction([], "throw " + ref) + ")");
	} else {
		base.stack.push(id);
		const result = serialize$1(ctx, fulfilled);
		base.stack.pop();
		serialized = promiseConstructor + "(" + result + ")";
	}
	return serialized;
}
function serializeBoxed(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return "Object(" + serialize$1(ctx, node.f!) + ")";
}
function getConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const current = serialize$1(ctx, node);
	return node.t === 4 ? current : "(" + current + ")";
}
function serializePromiseConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	if (ctx.mode === 1) throw new SerovalUnsupportedNodeError(node);
	return "(" + assignIndexedValue(ctx, node.s/*$*/ as SV.RefId/*$*/, getConstructor(ctx, node.f!) + "()") + ").p";
}
function serializePromiseResolve(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	if (ctx.mode === 1) throw new SerovalUnsupportedNodeError(node);
	return getConstructor(ctx, node.a![0]/*$*/ as SV.SerovalNode/*$*/) + "(" + getRefParam(ctx, node.i!) + "," + serialize$1(ctx, node.a![1]/*$*/ as SV.SerovalNode/*$*/) + ")";
}
function serializePromiseReject(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	if (ctx.mode === 1) throw new SerovalUnsupportedNodeError(node);
	return getConstructor(ctx, node.a![0]/*$*/ as SV.SerovalNode/*$*/) + "(" + getRefParam(ctx, node.i!) + "," + serialize$1(ctx, node.a![1]/*$*/ as SV.SerovalNode/*$*/) + ")";
}
function serializePlugin(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const currentPlugins = ctx.base.plugins;
	if (currentPlugins) for (let i = 0, len = currentPlugins.length; i < len; i++) {
		const plugin = currentPlugins[i];
		if (plugin.tag === node.c) {
			if (ctx.child == null) ctx.child = new SerializePluginContext(ctx);
			return plugin.serialize(node.s, ctx.child, { id: node.i });
		}
	}
	throw new SerovalMissingPluginError(node.c);
}
function serializeIteratorFactory(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	let result = "";
	let initialized = false;
	if (node.f!.t !== 4) {
		markSerializerRef(ctx.base, node.f!.i!);
		result = "(" + serialize$1(ctx, node.f!) + ",";
		initialized = true;
	}
	result += assignIndexedValue(ctx, node.i!, "(" + SERIALIZED_ITERATOR_CONSTRUCTOR + ")(" + getRefParam(ctx, node.f!.i!) + ")");
	if (initialized) result += ")";
	return result;
}
function serializeIteratorFactoryInstance(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getConstructor(ctx, node.a![0]/*$*/ as SV.SerovalNode/*$*/) + "(" + serialize$1(ctx, node.a![1]/*$*/ as SV.SerovalNode/*$*/) + ")";
}
function serializeAsyncIteratorFactory(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const promise = node.a![0]/*$*/ as SV.SerovalNode/*$*/;
	const symbol = node.a![1]/*$*/ as SV.SerovalNode/*$*/;
	const base = ctx.base;
	let result = "";
	if (promise.t !== 4) {
		markSerializerRef(base, promise.i!);
		result += "(" + serialize$1(ctx, promise);
	}
	if (symbol.t !== 4) {
		markSerializerRef(base, symbol.i!);
		result += (result ? "," : "(") + serialize$1(ctx, symbol);
	}
	if (result) result += ",";
	const iterator = assignIndexedValue(ctx, node.i!, "(" + SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR + ")(" + getRefParam(ctx, symbol.i!) + "," + getRefParam(ctx, promise.i!) + ")");
	if (result) return result + iterator + ")";
	return iterator;
}
function serializeAsyncIteratorFactoryInstance(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getConstructor(ctx, node.a![0]/*$*/ as SV.SerovalNode/*$*/) + "(" + serialize$1(ctx, node.a![1]/*$*/ as SV.SerovalNode/*$*/) + ")";
}
function serializeStreamConstructor(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const result = assignIndexedValue(ctx, node.i!, getConstructor(ctx, node.f!) + "()");
	const len = node.a!.length;
	if (len) {
		let values = serialize$1(ctx, node.a![0]/*$*/ as SV.SerovalNode/*$*/);
		for (let i = 1; i < len; i++) values += "," + serialize$1(ctx, node.a![i]/*$*/ as SV.SerovalNode/*$*/);
		return "(" + result + "," + values + "," + getRefParam(ctx, node.i!) + ")";
	}
	return result;
}
function serializeStreamNext(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getRefParam(ctx, node.i!) + ".next(" + serialize$1(ctx, node.f!) + ")";
}
function serializeStreamThrow(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getRefParam(ctx, node.i!) + ".throw(" + serialize$1(ctx, node.f!) + ")";
}
function serializeStreamReturn(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	return getRefParam(ctx, node.i!) + ".return(" + serialize$1(ctx, node.f!) + ")";
}
function serializeSequenceItem(ctx: SV.SerializerContext, id: SV.RefId, index: number, item: SV.SerovalNode): string {
	const base = ctx.base;
	if (isIndexedValueInStack(base, item)) {
		markSerializerRef(base, id);
		createSequenceAssign(ctx, id, index, getRefParam(ctx, item.i!));
		return "";
	}
	return serialize$1(ctx, item);
}
function serializeSequence(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	const items = node.a!;
	const size = items.length;
	const id = node.i!;
	if (size > 0) {
		ctx.base.stack.push(id);
		let result = serializeSequenceItem(ctx, id, 0, items[0]/*$*/ as SV.SerovalNode/*$*/);
		for (let i: number = 1, item = result; i < size; i++) {
			item = serializeSequenceItem(ctx, id, i, items[i]/*$*/ as SV.SerovalNode/*$*/);
			result += (item && result && ",") + item;
		}
		ctx.base.stack.pop();
		if (result) return "{__SEROVAL_SEQUENCE__:!0,v:[" + result + "],t:" + /*$*/(/*$*/node.s/*$*/ as SV.SequenceIndex)/*$*/ + ",d:" + node.l! + "}";
	}
	return "{__SEROVAL_SEQUENCE__:!0,v:[],t:-1,d:0}";
}
function serializeAssignable(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	switch (node.t) {
		case 17: return SYMBOL_STRING[node.s/*$*/ as SV.SymbolTag/*$*/];
		case 18: return serializeReference(node);
		case 9: return serializeArray(ctx, node);
		case 10: return serializeObject(ctx, node);
		case 11: return serializeNullConstructor(ctx, node);
		case 5: return serializeDate(node);
		case 6: return serializeRegExp(ctx, node);
		case 7: return serializeSet(ctx, node);
		case 8: return serializeMap(ctx, node);
		case 19: return serializeArrayBuffer(ctx, node);
		case 16:
		case 15: return serializeTypedArray(ctx, node);
		case 20: return serializeDataView(ctx, node);
		case 14: return serializeAggregateError(ctx, node);
		case 13: return serializeError(ctx, node);
		case 12: return serializePromise(ctx, node);
		case 21: return serializeBoxed(ctx, node);
		case 22: return serializePromiseConstructor(ctx, node);
		case 25: return serializePlugin(ctx, node);
		case 26: return SPECIAL_REF_STRING[node.s/*$*/ as SV.SpecialRef/*$*/];
		case 35: return serializeSequence(ctx, node);
		case 36: return serializeTemporal(ctx, node);
		default: throw new SerovalUnsupportedNodeError(node);
	}
}
function serialize$1(ctx: SV.SerializerContext, node: SV.SerovalNode): string {
	switch (node.t) {
		case 2: return CONSTANT_STRING[node.s/*$*/ as SV.ConstantTag/*$*/];
		case 0: return "" + /*$*/(/*$*/node.s/*$*/ as number)/*$*/;
		case 1: return "\"" + /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "\"";
		case 3: return /*$*/(/*$*/node.s/*$*/ as string)/*$*/ + "n";
		case 4: return getRefParam(ctx, node.i!);
		case 23: return serializePromiseResolve(ctx, node);
		case 24: return serializePromiseReject(ctx, node);
		case 27: return serializeIteratorFactory(ctx, node);
		case 28: return serializeIteratorFactoryInstance(ctx, node);
		case 29: return serializeAsyncIteratorFactory(ctx, node);
		case 30: return serializeAsyncIteratorFactoryInstance(ctx, node);
		case 31: return serializeStreamConstructor(ctx, node);
		case 32: return serializeStreamNext(ctx, node);
		case 33: return serializeStreamThrow(ctx, node);
		case 34: return serializeStreamReturn(ctx, node);
		default: return assignIndexedValue(ctx, node.i!, serializeAssignable(ctx, node));
	}
}
function serializeTopVanilla(ctx: SV.SerializerContext, tree: SV.SerovalNode): string {
	const result = serialize$1(ctx, tree);
	if (tree.i != null && /*$*/(/*$*/ctx.state/*$*/ as SV.VanillaSerializerState)/*$*/.vars.length) {
		const patches = resolvePatches(ctx.base);
		let body = result;
		if (patches) {
			const index = getRefParam(ctx, tree.i);
			body = result + "," + patches + index;
			if (!result.startsWith(index + "=")) body = index + "=" + body;
			body = "(" + body + ")";
		}
		return "(" + createFunction(/*$*/(/*$*/ctx.state/*$*/ as SV.VanillaSerializerState)/*$*/.vars, body) + ")()";
	}
	if (tree.t === 10) return "(" + result + ")";
	return result;
}
function serializeTopCross(ctx: SV.SerializerContext, tree: SV.SerovalNode): string {
	const result = serialize$1(ctx, tree);
	const id: SV.RefId | undefined = tree.i;
	if (id == null) return result;
	const patches = resolvePatches(ctx.base);
	const ref = getRefParam(ctx, id);
	const scopeId: SV.ScopeId = /*$*/(/*$*/ctx.state/*$*/ as SV.SerializerOptions)/*$*/.scopeId;
	const params = scopeId == null ? "" : "$R";
	const body = patches ? "(" + result + "," + patches + ref + ")" : result;
	if (params === "") {
		if (tree.t === 10 && !patches) return "(" + body + ")";
		return body;
	}
	const args = scopeId == null ? "()" : "($R[\"" + serializeString(scopeId) + "\"])";
	return "(" + createFunction([params], body) + ")" + args;
}
//#endregion
//#region src/core/context/sync-parser.ts
function createSyncParserContext(mode: SV.Mode, options: SV.ParserOptions): SV.ParserContext {
	return {
		type: 1,
		base: createBaseParserContext(mode, options),
		child: void 0
	};
}
var SyncParsePluginContext = class { /*$*/declare _p: SV.ParserContext; declare depth: SV.Depth;/*$*/
	constructor(_p: SV.ParserContext, depth: SV.Depth) {
		this._p = _p;
		this.depth = depth;
	}
	parse(current: SV.Given): SV.SerovalNode {
		return parseSOS(this._p, this.depth, current);
	}
};
var StreamParsePluginContext = class { /*$*/declare _p: SV.ParserContext; declare depth: SV.Depth;/*$*/
	constructor(_p: SV.ParserContext, depth: SV.Depth) {
		this._p = _p;
		this.depth = depth;
	}
	parse(current: SV.Given): SV.SerovalNode {
		return parseSOS(this._p, this.depth, current);
	}
	parseWithError(current: SV.Given): SV.SerovalNode | undefined {
		return parseWithError(this._p, this.depth, current);
	}
	isAlive(): boolean {
		return this._p.state!.alive;
	}
	pushPendingState(): void {
		pushPendingState(this._p);
	}
	popPendingState(): void {
		popPendingState(this._p);
	}
	onParse(node: SV.GivenNode): void {
		onParse(this._p, node);
	}
	onError(error: SV.Thrown): void {
		onError(this._p, error);
	}
	addCleanup(callback: SV.Cleanup): void {
		this._p.state!.cleanups.push(callback);
	}
};
function createStreamParserState(options: SV.ParserOptions): SV.StreamParserState {
	return {
		alive: true,
		pending: 0,
		initial: true,
		buffer: [],
		onParse: options.onParse,
		onError: options.onError,
		onDone: options.onDone,
		cleanups: []
	};
}
function createStreamParserContext(options: SV.ParserOptions): SV.ParserContext {
	return {
		type: 2,
		base: createBaseParserContext(2, options),
		state: createStreamParserState(options)
	};
}
function parseItems(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given[]): SV.NodeItem[] {
	const nodes: SV.NodeItem[] = [];
	for (let i = 0, len = current.length; i < len; i++) if (i in current) nodes[i] = parseSOS(ctx, depth, current[i]);
	else nodes[i] = 0;
	return nodes;
}
function parseArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given[]): SV.SerovalNode {
	return createArrayNode(id, current, parseItems(ctx, depth, current));
}
function parseProperties(ctx: SV.ParserContext, depth: SV.Depth, properties: SV.Given): SV.ObjectRecord {
	const entries = Object.entries(properties);
	const keyNodes: SV.RecordKey[] = [];
	const valueNodes: SV.SerovalNode[] = [];
	for (let i = 0, len = entries.length; i < len; i++) {
		keyNodes.push(serializeString(entries[i][0]));
		valueNodes.push(parseSOS(ctx, depth, entries[i][1]));
	}
	if (SYM_ITERATOR in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ITERATOR));
		valueNodes.push(createIteratorFactoryInstanceNode(parseIteratorFactory(ctx.base), parseSOS(ctx, depth, createSequenceFromIterable(properties))));
	}
	if (SYM_ASYNC_ITERATOR in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ASYNC_ITERATOR));
		valueNodes.push(createAsyncIteratorFactoryInstanceNode(parseAsyncIteratorFactory(ctx.base), parseSOS(ctx, depth, ctx.type === 1 ? createStream() : createStreamFromAsyncIterable(properties, ctx.state!.cleanups))));
	}
	if (SYM_TO_STRING_TAG in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_TO_STRING_TAG));
		valueNodes.push(createStringNode(properties[SYM_TO_STRING_TAG]));
	}
	if (SYM_IS_CONCAT_SPREADABLE in properties) {
		keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_IS_CONCAT_SPREADABLE));
		valueNodes.push(properties[SYM_IS_CONCAT_SPREADABLE] ? TRUE_NODE : FALSE_NODE);
	}
	return {
		k: keyNodes,
		v: valueNodes
	};
}
function parsePlainObject(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, empty: boolean): SV.SerovalNode {
	return createObjectNode(id, current, empty, parseProperties(ctx, depth, current));
}
function parseBoxed(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	return createBoxedNode(id, parseSOS(ctx, depth, current.valueOf()));
}
function parseTypedArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	current = getArrayBufferView(ctx.base, current);
	return createTypedArrayNode(id, current, parseSOS(ctx, depth, current.buffer));
}
function parseBigIntTypedArray(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	current = getArrayBufferView(ctx.base, current);
	return createBigIntTypedArrayNode(id, current, parseSOS(ctx, depth, current.buffer));
}
function parseDataView(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	current = getArrayBufferView(ctx.base, current);
	return createDataViewNode(id, current, parseSOS(ctx, depth, current.buffer));
}
function parseError(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const options = getErrorOptions(current, ctx.base.features);
	return createErrorNode(id, current, options ? parseProperties(ctx, depth, options) : void 0);
}
function parseAggregateError(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const options = getErrorOptions(current, ctx.base.features);
	return createAggregateErrorNode(id, current, options ? parseProperties(ctx, depth, options) : void 0);
}
function parseMap(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const keyNodes: SV.SerovalNode[] = [];
	const valueNodes: SV.SerovalNode[] = [];
	for (const [key, value] of current.entries()) {
		keyNodes.push(parseSOS(ctx, depth, key));
		valueNodes.push(parseSOS(ctx, depth, value));
	}
	return createMapNode(ctx.base, id, keyNodes, valueNodes);
}
function parseSet(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const items: SV.SerovalNode[] = [];
	for (const item of current.keys()) items.push(parseSOS(ctx, depth, item));
	return createSetNode(id, items);
}
function parseStream(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Stream>): SV.SerovalNode {
	const result = createStreamConstructorNode(id, parseSpecialReference(ctx.base, 4), []);
	if (ctx.type === 1) return result;
	pushPendingState(ctx);
	current.on({
		next: (value: SV.Given): void => {
			if (ctx.state!.alive) {
				const parsed = parseWithError(ctx, depth, value);
				if (parsed) onParse(ctx, createStreamNextNode(id, parsed));
			}
		},
		throw: (value: SV.Given): void => {
			if (ctx.state!.alive) {
				const parsed = parseWithError(ctx, depth, value);
				if (parsed) onParse(ctx, createStreamThrowNode(id, parsed));
			}
			popPendingState(ctx);
		},
		return: (value: SV.Given): void => {
			if (ctx.state!.alive) {
				const parsed = parseWithError(ctx, depth, value);
				if (parsed) onParse(ctx, createStreamReturnNode(id, parsed));
			}
			popPendingState(ctx);
		}
	});
	return result;
}
function handlePromiseSuccess(this: SV.ParserContext, id: SV.RefId, depth: SV.Depth, data: SV.Given): void {
	if (this.state!.alive) {
		const parsed = parseWithError(this, depth, data);
		if (parsed) onParse(this, createSerovalNode(23, id, void 0, void 0, void 0, void 0, void 0, [parseSpecialReference(this.base, 2), parsed], void 0, void 0, void 0, void 0));
		popPendingState(this);
	}
}
function handlePromiseFailure(this: SV.ParserContext, id: SV.RefId, depth: SV.Depth, data: SV.Given): void {
	if (this.state!.alive) {
		const parsed = parseWithError(this, depth, data);
		if (parsed) onParse(this, createSerovalNode(24, id, void 0, void 0, void 0, void 0, void 0, [parseSpecialReference(this.base, 3), parsed], void 0, void 0, void 0, void 0));
	}
	popPendingState(this);
}
function parsePromise(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	const resolver: SV.RefId = createIndexForValue(ctx.base, {});
	if (ctx.type === 2) {
		pushPendingState(ctx);
		current.then(handlePromiseSuccess.bind(ctx, resolver, depth), handlePromiseFailure.bind(ctx, resolver, depth));
	}
	return createPromiseConstructorNode(ctx.base, id, resolver);
}
function parsePluginSync(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentPlugins: SV.Plugins): SV.SerovalNode | undefined {
	for (let i = 0, len = currentPlugins.length; i < len; i++) {
		const plugin: SV.Plugin = currentPlugins[i];
		if (plugin.parse.sync && plugin.test(current)) return createPluginNode(id, plugin.tag, plugin.parse.sync(current, new SyncParsePluginContext(ctx, depth), { id }));
	}
}
function parsePluginStream(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentPlugins: SV.Plugins): SV.SerovalNode | undefined {
	for (let i = 0, len = currentPlugins.length; i < len; i++) {
		const plugin: SV.Plugin = currentPlugins[i];
		if (plugin.parse.stream && plugin.test(current)) return createPluginNode(id, plugin.tag, plugin.parse.stream(current, new StreamParsePluginContext(ctx, depth), { id }));
	}
}
function parsePlugin(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode | undefined {
	const currentPlugins = ctx.base.plugins;
	if (currentPlugins) return ctx.type === 1 ? parsePluginSync(ctx, depth, id, current, currentPlugins) : parsePluginStream(ctx, depth, id, current, currentPlugins);
}
function parseSequence(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: InstanceType<typeof Sequence>): SV.SerovalNode {
	const nodes: SV.SerovalNode[] = [];
	for (let i = 0, len = current.v.length; i < len; i++) nodes[i] = parseSOS(ctx, depth, current.v[i]);
	return createSequenceNode(id, nodes, current.t, current.d);
}
function parseObjectPhase2(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given, currentClass: SV.GivenClass): SV.SerovalNode {
	switch (currentClass) {
		case Object: return parsePlainObject(ctx, depth, id, current, false);
		case void 0: return parsePlainObject(ctx, depth, id, current, true);
		case Date: return createDateNode(id, current);
		case Error:
		case EvalError:
		case RangeError:
		case ReferenceError:
		case SyntaxError:
		case TypeError:
		case URIError: return parseError(ctx, depth, id, current);
		case Number:
		case Boolean:
		case String:
		case BigInt: return parseBoxed(ctx, depth, id, current);
		case ArrayBuffer: return createArrayBufferNode(ctx.base, id, current);
		case Int8Array:
		case Int16Array:
		case Int32Array:
		case Uint8Array:
		case Uint16Array:
		case Uint32Array:
		case Uint8ClampedArray:
		case Float32Array:
		case Float64Array: return parseTypedArray(ctx, depth, id, current);
		case DataView: return parseDataView(ctx, depth, id, current);
		case Map: return parseMap(ctx, depth, id, current);
		case Set: return parseSet(ctx, depth, id, current);
	}
	if (currentClass === Promise || current instanceof Promise) return parsePromise(ctx, depth, id, current);
	const currentFeatures: SV.Features = ctx.base.features;
	if (currentFeatures & 32 && currentClass === RegExp) return createRegExpNode(id, current);
	if (currentFeatures & 16) switch (currentClass) {
		case BigInt64Array:
		case BigUint64Array: return parseBigIntTypedArray(ctx, depth, id, current);
	}
	if (currentFeatures & 1 && typeof AggregateError !== "undefined" && (currentClass === AggregateError || current instanceof AggregateError)) return parseAggregateError(ctx, depth, id, current);
	if (currentFeatures & 64 && typeof Temporal !== "undefined") switch (currentClass) {
		case Temporal.Instant: return createTemporalNode(id, 0, current);
		case Temporal.Duration: return createTemporalNode(id, 1, current);
		case Temporal.PlainDate: return createTemporalNode(id, 2, current);
		case Temporal.PlainDateTime: return createTemporalNode(id, 3, current);
		case Temporal.PlainMonthDay: return createTemporalNode(id, 4, current);
		case Temporal.PlainTime: return createTemporalNode(id, 5, current);
		case Temporal.PlainYearMonth: return createTemporalNode(id, 6, current);
		case Temporal.ZonedDateTime: return createTemporalNode(id, 7, current);
	}
	if (current instanceof Error) return parseError(ctx, depth, id, current);
	if (SYM_ITERATOR in current || SYM_ASYNC_ITERATOR in current) return parsePlainObject(ctx, depth, id, current, !!currentClass);
	throw new SerovalUnsupportedTypeError(current);
}
function parseObject(ctx: SV.ParserContext, depth: SV.Depth, id: SV.RefId, current: SV.Given): SV.SerovalNode {
	if (Array.isArray(current)) return parseArray(ctx, depth, id, current);
	if (isStream(current)) return parseStream(ctx, depth, id, current);
	if (isSequence(current)) return parseSequence(ctx, depth, id, current);
	let currentClass: SV.GivenClass = current.constructor;
	if (currentClass !== void 0 && typeof currentClass !== "function") {
		const proto: SV.Given = Object.getPrototypeOf(current);
		currentClass = proto === null ? void 0 : proto.constructor;
	}
	if (currentClass === OpaqueReference) return parseSOS(ctx, depth, current.replacement);
	const parsed = parsePlugin(ctx, depth, id, current);
	if (parsed) return parsed;
	return parseObjectPhase2(ctx, depth, id, current, currentClass);
}
function parseFunction(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode {
	const ref = getReferenceNode(ctx.base, current);
	if (ref.type !== 0) return ref.value/*$*/ as SV.SerovalNode/*$*/;
	const plugin = parsePlugin(ctx, depth, ref.value/*$*/ as SV.RefId/*$*/, current);
	if (plugin) return plugin;
	throw new SerovalUnsupportedTypeError(current);
}
function parseSOS(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode {
	if (depth >= ctx.base.depthLimit) throw new SerovalDepthLimitError(ctx.base.depthLimit);
	switch (typeof current) {
		case "boolean": return current ? TRUE_NODE : FALSE_NODE;
		case "undefined": return UNDEFINED_NODE;
		case "string": return createStringNode(current);
		case "number": return createNumberNode(current);
		case "bigint": return createBigIntNode(current);
		case "object":
			if (current) {
				const ref = getReferenceNode(ctx.base, current);
				return ref.type === 0 ? parseObject(ctx, depth + 1, ref.value/*$*/ as SV.RefId/*$*/, current) : ref.value/*$*/ as SV.SerovalNode/*$*/;
			}
			return NULL_NODE;
		case "symbol": return parseWellKnownSymbol(ctx.base, current);
		case "function": return parseFunction(ctx, depth, current);
		default: throw new SerovalUnsupportedTypeError(current);
	}
}
function parseTop(ctx: SV.ParserContext, current: SV.Given): SV.SerovalNode {
	try {
		return parseSOS(ctx, 0, current);
	} catch (error: SV.Thrown) {
		throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
	}
}
function onParse(ctx: SV.ParserContext, node: SV.SerovalNode): void {
	if (ctx.state!.initial) ctx.state!.buffer.push(node);
	else onParseInternal(ctx, node, false);
}
function onError(ctx: SV.ParserContext, error: SV.Thrown): void {
	if (ctx.state!.onError) ctx.state!.onError(error);
	else throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
}
function onDone(ctx: SV.ParserContext): void {
	if (ctx.state!.onDone) ctx.state!.onDone();
	for (let i = 0, len = ctx.state!.cleanups.length; i < len; i++) ctx.state!.cleanups[i]();
}
function onParseInternal(ctx: SV.ParserContext, node: SV.SerovalNode, initial: boolean): void {
	try {
		ctx.state!.onParse(node, initial);
	} catch (error: SV.Thrown) {
		onError(ctx, error);
	}
}
function pushPendingState(ctx: SV.ParserContext): void {
	ctx.state!.pending++;
}
function popPendingState(ctx: SV.ParserContext): void {
	if (--ctx.state!.pending <= 0) onDone(ctx);
}
function parseWithError(ctx: SV.ParserContext, depth: SV.Depth, current: SV.Given): SV.SerovalNode | undefined {
	try {
		return parseSOS(ctx, depth, current);
	} catch (err: SV.Thrown) {
		onError(ctx, err);
		return;
	}
}
function startStreamParse(ctx: SV.ParserContext, current: SV.Given): void {
	const parsed = parseWithError(ctx, 0, current);
	if (parsed) {
		onParseInternal(ctx, parsed, true);
		ctx.state!.initial = false;
		flushStreamParse(ctx, ctx.state!);
		if (ctx.state!.pending <= 0) destroyStreamParse(ctx);
	}
}
function flushStreamParse(ctx: SV.ParserContext, state: SV.StreamParserState): void {
	for (let i = 0, len = state.buffer.length; i < len; i++) onParseInternal(ctx, state.buffer[i], false);
}
function destroyStreamParse(ctx: SV.ParserContext): void {
	if (ctx.state!.alive) {
		onDone(ctx);
		ctx.state!.alive = false;
	}
}
//#endregion
//#region src/core/cross/index.ts
function crossSerialize(source: SV.Given, options: SV.Options = {}): string {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createSyncParserContext(2, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures,
		refs: options.refs
	});
	const tree = parseTop(ctx, source);
	return serializeTopCross(createCrossSerializerContext({
		plugins,
		features: ctx.base.features,
		scopeId: options.scopeId,
		markedRefs: ctx.base.marked
	}), tree);
}
async function crossSerializeAsync(source: SV.Given, options: SV.Options = {}): Promise<string> {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createAsyncParserContext(2, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures,
		refs: options.refs
	});
	const tree = await parseTopAsync(ctx, source);
	return serializeTopCross(createCrossSerializerContext({
		plugins,
		features: ctx.base.features,
		scopeId: options.scopeId,
		markedRefs: ctx.base.marked
	}), tree);
}
function toCrossJSON(source: SV.Given, options: SV.Options = {}): SV.ExportedNode {
	const plugins = resolvePlugins(options.plugins);
	return parseTop(createSyncParserContext(2, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures,
		refs: options.refs
	}), source);
}
async function toCrossJSONAsync(source: SV.Given, options: SV.Options = {}): Promise<SV.ExportedNode> {
	const plugins = resolvePlugins(options.plugins);
	return await parseTopAsync(createAsyncParserContext(2, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures,
		refs: options.refs
	}), source);
}
function crossSerializeStream(source: SV.Given, options: SV.Options): SV.Cleanup {
	const plugins = resolvePlugins(options.plugins);
	const ctx: SV.ParserContext = createStreamParserContext({
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		refs: options.refs,
		disabledFeatures: options.disabledFeatures,
		onParse(node: SV.SerovalNode, initial: boolean) {
			const serial = createCrossSerializerContext({
				plugins,
				features: ctx.base.features,
				scopeId: options.scopeId,
				markedRefs: ctx.base.marked
			});
			let serialized: string;
			try {
				serialized = serializeTopCross(serial, node);
			} catch (err: SV.Thrown) {
				if (options.onError) options.onError(err);
				return;
			}
			options.onSerialize(serialized, initial);
		},
		onError: options.onError,
		onDone: options.onDone
	});
	startStreamParse(ctx, source);
	return destroyStreamParse.bind(null, ctx);
}
function toCrossJSONStream(source: SV.Given, options: SV.Options): SV.Cleanup {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createStreamParserContext({
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		refs: options.refs,
		disabledFeatures: options.disabledFeatures,
		depthLimit: options.depthLimit,
		onParse: options.onParse,
		onError: options.onError,
		onDone: options.onDone
	});
	startStreamParse(ctx, source);
	return destroyStreamParse.bind(null, ctx);
}
function fromCrossJSON(source: SV.GivenNode, options: SV.Options): SV.Deserialized {
	const plugins = resolvePlugins(options.plugins);
	return deserializeTop(createCrossDeserializerContext({
		maxBase64Length: options.maxBase64Length,
		plugins,
		refs: options.refs,
		features: options.features,
		disabledFeatures: options.disabledFeatures,
		depthLimit: options.depthLimit
	}), source);
}
//#endregion
//#region src/core/Serializer.ts
var Serializer = class { /*$*/declare options: SV.Options; declare alive: boolean; declare flushed: boolean; declare done: boolean; declare pending: SV.Count; declare cleanups: SV.Cleanup[]; declare refs: SV.ParserRefs; declare keys: Set<string>; declare ids: SV.Count; declare plugins: SV.Plugins | undefined;/*$*/
	constructor(options: SV.Options) {
		this.options = options;
		this.alive = true;
		this.flushed = false;
		this.done = false;
		this.pending = 0;
		this.cleanups = [];
		this.refs = /* @__PURE__ */ new Map();
		this.keys = /* @__PURE__ */ new Set();
		this.ids = 0;
		this.plugins = resolvePlugins(options.plugins);
	}
	write(key: string, value: SV.Given): void {
		if (this.alive && !this.flushed) {
			this.pending++;
			this.keys.add(key);
			this.cleanups.push(crossSerializeStream(value, {
				plugins: this.plugins,
				scopeId: this.options.scopeId,
				refs: this.refs,
				disabledFeatures: this.options.disabledFeatures,
				compactArrayBufferViews: this.options.compactArrayBufferViews,
				onError: this.options.onError,
				onSerialize: (data: string, initial: boolean): void => {
					if (this.alive) this.options.onData(initial ? this.options.globalIdentifier + "[\"" + serializeString(key) + "\"]=" + data : data);
				},
				onDone: (): void => {
					if (this.alive) {
						this.pending--;
						if (this.pending <= 0 && this.flushed && !this.done && this.options.onDone) {
							this.options.onDone();
							this.done = true;
						}
					}
				}
			}));
		}
	}
	getNextID(): string {
		while (this.keys.has("" + this.ids)) this.ids++;
		return "" + this.ids;
	}
	push(value: SV.Given): string {
		const newID = this.getNextID();
		this.write(newID, value);
		return newID;
	}
	flush(): void {
		if (this.alive) {
			this.flushed = true;
			if (this.pending <= 0 && !this.done && this.options.onDone) {
				this.options.onDone();
				this.done = true;
			}
		}
	}
	close(): void {
		if (this.alive) {
			for (let i = 0, len = this.cleanups.length; i < len; i++) this.cleanups[i]();
			if (!this.done && this.options.onDone) {
				this.options.onDone();
				this.done = true;
			}
			this.alive = false;
		}
	}
};
//#endregion
//#region src/core/tree/index.ts
function serialize(source: SV.Given, options: SV.Options = {}): string {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createSyncParserContext(1, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures
	});
	const tree = parseTop(ctx, source);
	return serializeTopVanilla(createVanillaSerializerContext({
		plugins,
		features: ctx.base.features,
		markedRefs: ctx.base.marked
	}), tree);
}
async function serializeAsync(source: SV.Given, options: SV.Options = {}): Promise<string> {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createAsyncParserContext(1, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures
	});
	const tree = await parseTopAsync(ctx, source);
	return serializeTopVanilla(createVanillaSerializerContext({
		plugins,
		features: ctx.base.features,
		markedRefs: ctx.base.marked
	}), tree);
}
function deserialize(source: SV.GivenString): SV.Deserialized {
	return (0, eval)(source);
}
function toJSON(source: SV.Given, options: SV.Options = {}): SV.ExportedJSON {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createSyncParserContext(1, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures
	});
	return {
		t: parseTop(ctx, source),
		f: ctx.base.features,
		m: Array.from(ctx.base.marked)
	};
}
async function toJSONAsync(source: SV.Given, options: SV.Options = {}): Promise<SV.ExportedJSON> {
	const plugins = resolvePlugins(options.plugins);
	const ctx = createAsyncParserContext(1, {
		compactArrayBufferViews: options.compactArrayBufferViews,
		plugins,
		disabledFeatures: options.disabledFeatures
	});
	return {
		t: await parseTopAsync(ctx, source),
		f: ctx.base.features,
		m: Array.from(ctx.base.marked)
	};
}
function compileJSON(source: SV.GivenJSON, options: SV.Options = {}): string {
	return serializeTopVanilla(createVanillaSerializerContext({
		plugins: resolvePlugins(options.plugins),
		features: source.f,
		markedRefs: source.m
	}), source.t);
}
function fromJSON(source: SV.GivenJSON, options: SV.Options = {}): SV.Deserialized {
	var _source$f: SV.GivenNumber;
	const plugins = resolvePlugins(options.plugins);
	const disabledFeatures: SV.GivenNumber = options.disabledFeatures || 0;
	const sourceFeatures: SV.GivenNumber = (_source$f = source.f) !== null && _source$f !== void 0 ? _source$f : 127;
	return deserializeTop(createVanillaDeserializerContext({
		maxBase64Length: options.maxBase64Length,
		plugins,
		markedRefs: source.m,
		features: sourceFeatures & ~disabledFeatures,
		disabledFeatures
	}), source.t);
}
//#endregion
export { Feature, OpaqueReference, Serializer, SerovalConflictedNodeIdError, SerovalDepthLimitError, SerovalDeserializationError, SerovalError, SerovalMalformedNodeError, SerovalMissingInstanceError, SerovalMissingPluginError, SerovalMissingReferenceError, SerovalMissingReferenceForIdError, SerovalMode, SerovalParserError, SerovalSerializationError, SerovalUnknownTypedArrayError, SerovalUnsupportedNodeError, SerovalUnsupportedTypeError, compileJSON, createPlugin, createReference, createStream, crossSerialize, crossSerializeAsync, crossSerializeStream, deserialize, fromCrossJSON, fromJSON, getCrossReferenceHeader, isStream, resolvePlugins, serialize, serializeAsync, toCrossJSON, toCrossJSONAsync, toCrossJSONStream, toJSON, toJSONAsync };