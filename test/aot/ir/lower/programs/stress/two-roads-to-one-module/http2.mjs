// RUN: lower
// OPTIONS: builtin-modules

// Two roads to one module, one probe of many. It prints what plain Bun prints.
import * as space from "node:http2";
import whole from "node:http2";
import { ClientHttp2Session as named_ClientHttp2Session, Http2ServerRequest as named_Http2ServerRequest, Http2ServerResponse as named_Http2ServerResponse, connect as named_connect, constants as named_constants, createSecureServer as named_createSecureServer, createServer as named_createServer, getDefaultSettings as named_getDefaultSettings, getPackedSettings as named_getPackedSettings, getUnpackedSettings as named_getUnpackedSettings, performServerHandshake as named_performServerHandshake, sensitiveHeaders as named_sensitiveHeaders } from "node:http2";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:http2");
const asked = process.getBuiltinModule("node:http2");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("ClientHttp2Session", named_ClientHttp2Session === space.ClientHttp2Session, named_ClientHttp2Session === whole.ClientHttp2Session, named_ClientHttp2Session === required.ClientHttp2Session, named_ClientHttp2Session === asked.ClientHttp2Session, space.ClientHttp2Session === required.ClientHttp2Session, whole.ClientHttp2Session === required.ClientHttp2Session, asked.ClientHttp2Session === required.ClientHttp2Session, whole.ClientHttp2Session === space.ClientHttp2Session);
same("Http2ServerRequest", named_Http2ServerRequest === space.Http2ServerRequest, named_Http2ServerRequest === whole.Http2ServerRequest, named_Http2ServerRequest === required.Http2ServerRequest, named_Http2ServerRequest === asked.Http2ServerRequest, space.Http2ServerRequest === required.Http2ServerRequest, whole.Http2ServerRequest === required.Http2ServerRequest, asked.Http2ServerRequest === required.Http2ServerRequest, whole.Http2ServerRequest === space.Http2ServerRequest);
same("Http2ServerResponse", named_Http2ServerResponse === space.Http2ServerResponse, named_Http2ServerResponse === whole.Http2ServerResponse, named_Http2ServerResponse === required.Http2ServerResponse, named_Http2ServerResponse === asked.Http2ServerResponse, space.Http2ServerResponse === required.Http2ServerResponse, whole.Http2ServerResponse === required.Http2ServerResponse, asked.Http2ServerResponse === required.Http2ServerResponse, whole.Http2ServerResponse === space.Http2ServerResponse);
same("connect", named_connect === space.connect, named_connect === whole.connect, named_connect === required.connect, named_connect === asked.connect, space.connect === required.connect, whole.connect === required.connect, asked.connect === required.connect, whole.connect === space.connect);
same("constants", named_constants === space.constants, named_constants === whole.constants, named_constants === required.constants, named_constants === asked.constants, space.constants === required.constants, whole.constants === required.constants, asked.constants === required.constants, whole.constants === space.constants);
same("createSecureServer", named_createSecureServer === space.createSecureServer, named_createSecureServer === whole.createSecureServer, named_createSecureServer === required.createSecureServer, named_createSecureServer === asked.createSecureServer, space.createSecureServer === required.createSecureServer, whole.createSecureServer === required.createSecureServer, asked.createSecureServer === required.createSecureServer, whole.createSecureServer === space.createSecureServer);
same("createServer", named_createServer === space.createServer, named_createServer === whole.createServer, named_createServer === required.createServer, named_createServer === asked.createServer, space.createServer === required.createServer, whole.createServer === required.createServer, asked.createServer === required.createServer, whole.createServer === space.createServer);
same("getDefaultSettings", named_getDefaultSettings === space.getDefaultSettings, named_getDefaultSettings === whole.getDefaultSettings, named_getDefaultSettings === required.getDefaultSettings, named_getDefaultSettings === asked.getDefaultSettings, space.getDefaultSettings === required.getDefaultSettings, whole.getDefaultSettings === required.getDefaultSettings, asked.getDefaultSettings === required.getDefaultSettings, whole.getDefaultSettings === space.getDefaultSettings);
same("getPackedSettings", named_getPackedSettings === space.getPackedSettings, named_getPackedSettings === whole.getPackedSettings, named_getPackedSettings === required.getPackedSettings, named_getPackedSettings === asked.getPackedSettings, space.getPackedSettings === required.getPackedSettings, whole.getPackedSettings === required.getPackedSettings, asked.getPackedSettings === required.getPackedSettings, whole.getPackedSettings === space.getPackedSettings);
same("getUnpackedSettings", named_getUnpackedSettings === space.getUnpackedSettings, named_getUnpackedSettings === whole.getUnpackedSettings, named_getUnpackedSettings === required.getUnpackedSettings, named_getUnpackedSettings === asked.getUnpackedSettings, space.getUnpackedSettings === required.getUnpackedSettings, whole.getUnpackedSettings === required.getUnpackedSettings, asked.getUnpackedSettings === required.getUnpackedSettings, whole.getUnpackedSettings === space.getUnpackedSettings);
same("performServerHandshake", named_performServerHandshake === space.performServerHandshake, named_performServerHandshake === whole.performServerHandshake, named_performServerHandshake === required.performServerHandshake, named_performServerHandshake === asked.performServerHandshake, space.performServerHandshake === required.performServerHandshake, whole.performServerHandshake === required.performServerHandshake, asked.performServerHandshake === required.performServerHandshake, whole.performServerHandshake === space.performServerHandshake);
same("sensitiveHeaders", named_sensitiveHeaders === space.sensitiveHeaders, named_sensitiveHeaders === whole.sensitiveHeaders, named_sensitiveHeaders === required.sensitiveHeaders, named_sensitiveHeaders === asked.sensitiveHeaders, space.sensitiveHeaders === required.sensitiveHeaders, whole.sensitiveHeaders === required.sensitiveHeaders, asked.sensitiveHeaders === required.sensitiveHeaders, whole.sensitiveHeaders === space.sensitiveHeaders);

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
