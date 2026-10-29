// RUN: lower
// OPTIONS: builtin-modules

// Two roads to one module: diagnostics channel. It prints what plain Bun prints.
import * as space from "node:diagnostics_channel";
import whole from "node:diagnostics_channel";
import { Channel as named_Channel, channel as named_channel, hasSubscribers as named_hasSubscribers, subscribe as named_subscribe, tracingChannel as named_tracingChannel, unsubscribe as named_unsubscribe } from "node:diagnostics_channel";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:diagnostics_channel");
const asked = process.getBuiltinModule("node:diagnostics_channel");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Channel", named_Channel === space.Channel, named_Channel === whole.Channel, named_Channel === required.Channel, named_Channel === asked.Channel, space.Channel === required.Channel, whole.Channel === required.Channel, asked.Channel === required.Channel, whole.Channel === space.Channel);
same("channel", named_channel === space.channel, named_channel === whole.channel, named_channel === required.channel, named_channel === asked.channel, space.channel === required.channel, whole.channel === required.channel, asked.channel === required.channel, whole.channel === space.channel);
same("hasSubscribers", named_hasSubscribers === space.hasSubscribers, named_hasSubscribers === whole.hasSubscribers, named_hasSubscribers === required.hasSubscribers, named_hasSubscribers === asked.hasSubscribers, space.hasSubscribers === required.hasSubscribers, whole.hasSubscribers === required.hasSubscribers, asked.hasSubscribers === required.hasSubscribers, whole.hasSubscribers === space.hasSubscribers);
same("subscribe", named_subscribe === space.subscribe, named_subscribe === whole.subscribe, named_subscribe === required.subscribe, named_subscribe === asked.subscribe, space.subscribe === required.subscribe, whole.subscribe === required.subscribe, asked.subscribe === required.subscribe, whole.subscribe === space.subscribe);
same("tracingChannel", named_tracingChannel === space.tracingChannel, named_tracingChannel === whole.tracingChannel, named_tracingChannel === required.tracingChannel, named_tracingChannel === asked.tracingChannel, space.tracingChannel === required.tracingChannel, whole.tracingChannel === required.tracingChannel, asked.tracingChannel === required.tracingChannel, whole.tracingChannel === space.tracingChannel);
same("unsubscribe", named_unsubscribe === space.unsubscribe, named_unsubscribe === whole.unsubscribe, named_unsubscribe === required.unsubscribe, named_unsubscribe === asked.unsubscribe, space.unsubscribe === required.unsubscribe, whole.unsubscribe === required.unsubscribe, asked.unsubscribe === required.unsubscribe, whole.unsubscribe === space.unsubscribe);

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
