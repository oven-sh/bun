// RUN: lower
// OPTIONS: builtin-modules

// Two roads to one module: http common. It prints what plain Bun prints.
import * as space from "node:_http_common";
import whole from "node:_http_common";
import { CRLF as named_CRLF, HTTPParser as named_HTTPParser, MAX_HEADER_PAIRS as named_MAX_HEADER_PAIRS, calculateLenientFlags as named_calculateLenientFlags, chunkExpression as named_chunkExpression, continueExpression as named_continueExpression, freeParser as named_freeParser, isLenient as named_isLenient, kIncomingMessage as named_kIncomingMessage, kSkipPendingData as named_kSkipPendingData, methods as named_methods, parsers as named_parsers, prepareError as named_prepareError, validateHeaderName as named_validateHeaderName, validateHeaderValue as named_validateHeaderValue } from "node:_http_common";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:_http_common");
const asked = process.getBuiltinModule("node:_http_common");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("CRLF", named_CRLF === space.CRLF, named_CRLF === whole.CRLF, named_CRLF === required.CRLF, named_CRLF === asked.CRLF, space.CRLF === required.CRLF, whole.CRLF === required.CRLF, asked.CRLF === required.CRLF, whole.CRLF === space.CRLF);
same("HTTPParser", named_HTTPParser === space.HTTPParser, named_HTTPParser === whole.HTTPParser, named_HTTPParser === required.HTTPParser, named_HTTPParser === asked.HTTPParser, space.HTTPParser === required.HTTPParser, whole.HTTPParser === required.HTTPParser, asked.HTTPParser === required.HTTPParser, whole.HTTPParser === space.HTTPParser);
same("MAX_HEADER_PAIRS", named_MAX_HEADER_PAIRS === space.MAX_HEADER_PAIRS, named_MAX_HEADER_PAIRS === whole.MAX_HEADER_PAIRS, named_MAX_HEADER_PAIRS === required.MAX_HEADER_PAIRS, named_MAX_HEADER_PAIRS === asked.MAX_HEADER_PAIRS, space.MAX_HEADER_PAIRS === required.MAX_HEADER_PAIRS, whole.MAX_HEADER_PAIRS === required.MAX_HEADER_PAIRS, asked.MAX_HEADER_PAIRS === required.MAX_HEADER_PAIRS, whole.MAX_HEADER_PAIRS === space.MAX_HEADER_PAIRS);
same("calculateLenientFlags", named_calculateLenientFlags === space.calculateLenientFlags, named_calculateLenientFlags === whole.calculateLenientFlags, named_calculateLenientFlags === required.calculateLenientFlags, named_calculateLenientFlags === asked.calculateLenientFlags, space.calculateLenientFlags === required.calculateLenientFlags, whole.calculateLenientFlags === required.calculateLenientFlags, asked.calculateLenientFlags === required.calculateLenientFlags, whole.calculateLenientFlags === space.calculateLenientFlags);
same("chunkExpression", named_chunkExpression === space.chunkExpression, named_chunkExpression === whole.chunkExpression, named_chunkExpression === required.chunkExpression, named_chunkExpression === asked.chunkExpression, space.chunkExpression === required.chunkExpression, whole.chunkExpression === required.chunkExpression, asked.chunkExpression === required.chunkExpression, whole.chunkExpression === space.chunkExpression);
same("continueExpression", named_continueExpression === space.continueExpression, named_continueExpression === whole.continueExpression, named_continueExpression === required.continueExpression, named_continueExpression === asked.continueExpression, space.continueExpression === required.continueExpression, whole.continueExpression === required.continueExpression, asked.continueExpression === required.continueExpression, whole.continueExpression === space.continueExpression);
same("freeParser", named_freeParser === space.freeParser, named_freeParser === whole.freeParser, named_freeParser === required.freeParser, named_freeParser === asked.freeParser, space.freeParser === required.freeParser, whole.freeParser === required.freeParser, asked.freeParser === required.freeParser, whole.freeParser === space.freeParser);
same("isLenient", named_isLenient === space.isLenient, named_isLenient === whole.isLenient, named_isLenient === required.isLenient, named_isLenient === asked.isLenient, space.isLenient === required.isLenient, whole.isLenient === required.isLenient, asked.isLenient === required.isLenient, whole.isLenient === space.isLenient);
same("kIncomingMessage", named_kIncomingMessage === space.kIncomingMessage, named_kIncomingMessage === whole.kIncomingMessage, named_kIncomingMessage === required.kIncomingMessage, named_kIncomingMessage === asked.kIncomingMessage, space.kIncomingMessage === required.kIncomingMessage, whole.kIncomingMessage === required.kIncomingMessage, asked.kIncomingMessage === required.kIncomingMessage, whole.kIncomingMessage === space.kIncomingMessage);
same("kSkipPendingData", named_kSkipPendingData === space.kSkipPendingData, named_kSkipPendingData === whole.kSkipPendingData, named_kSkipPendingData === required.kSkipPendingData, named_kSkipPendingData === asked.kSkipPendingData, space.kSkipPendingData === required.kSkipPendingData, whole.kSkipPendingData === required.kSkipPendingData, asked.kSkipPendingData === required.kSkipPendingData, whole.kSkipPendingData === space.kSkipPendingData);
same("methods", named_methods === space.methods, named_methods === whole.methods, named_methods === required.methods, named_methods === asked.methods, space.methods === required.methods, whole.methods === required.methods, asked.methods === required.methods, whole.methods === space.methods);
same("parsers", named_parsers === space.parsers, named_parsers === whole.parsers, named_parsers === required.parsers, named_parsers === asked.parsers, space.parsers === required.parsers, whole.parsers === required.parsers, asked.parsers === required.parsers, whole.parsers === space.parsers);
same("prepareError", named_prepareError === space.prepareError, named_prepareError === whole.prepareError, named_prepareError === required.prepareError, named_prepareError === asked.prepareError, space.prepareError === required.prepareError, whole.prepareError === required.prepareError, asked.prepareError === required.prepareError, whole.prepareError === space.prepareError);
same("validateHeaderName", named_validateHeaderName === space.validateHeaderName, named_validateHeaderName === whole.validateHeaderName, named_validateHeaderName === required.validateHeaderName, named_validateHeaderName === asked.validateHeaderName, space.validateHeaderName === required.validateHeaderName, whole.validateHeaderName === required.validateHeaderName, asked.validateHeaderName === required.validateHeaderName, whole.validateHeaderName === space.validateHeaderName);
same("validateHeaderValue", named_validateHeaderValue === space.validateHeaderValue, named_validateHeaderValue === whole.validateHeaderValue, named_validateHeaderValue === required.validateHeaderValue, named_validateHeaderValue === asked.validateHeaderValue, space.validateHeaderValue === required.validateHeaderValue, whole.validateHeaderValue === required.validateHeaderValue, asked.validateHeaderValue === required.validateHeaderValue, whole.validateHeaderValue === space.validateHeaderValue);

// GENERATED: same
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = PropGet v1 key="map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure function=[[f_2]]
// CHECK-NEXT: v12 = Call v10, v1, v11 calleeKey="map" calleeName="answers.map"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|"F"|"T"> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Add v8, v18
// CHECK-NEXT: v20 = Call v6, v4, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
